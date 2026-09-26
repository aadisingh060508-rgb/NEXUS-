package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type USBPolicy struct {
	DeviceID      string     `json:"deviceId"`
	DriveLetter   string     `json:"driveLetter"`
	Status        string     `json:"status"` // PENDING, APPROVED, DENIED, EXPIRED, REVOKED
	AllowPCToUSB  bool       `json:"allowPcToUsb"`
	AllowUSBToPC  bool       `json:"allowUsbToPc"`
	PolicyVersion int        `json:"policyVersion"`
	ExpiresAt     *time.Time `json:"expiresAt,omitempty"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

type Direction string

const (
	PCToUSB Direction = "PC_TO_USB"
	USBToPC Direction = "USB_TO_PC"
)

type Decision string

const (
	Allow   Decision = "ALLOW"
	Deny    Decision = "DENY"
	Pending Decision = "PENDING"
	Expired Decision = "EXPIRED"
)

type PolicyStore interface {
	Load() (map[string]USBPolicy, error)
	Save(policies map[string]USBPolicy) error
}

type JSONPolicyStore struct {
	FilePath string
}

func (s *JSONPolicyStore) Load() (map[string]USBPolicy, error) {
	data, err := os.ReadFile(s.FilePath)
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]USBPolicy), nil
		}
		return nil, err
	}
	var policies map[string]USBPolicy
	if err := json.Unmarshal(data, &policies); err != nil {
		return nil, err
	}
	if policies == nil {
		policies = make(map[string]USBPolicy)
	}
	return policies, nil
}

func (s *JSONPolicyStore) Save(policies map[string]USBPolicy) error {
	if err := os.MkdirAll(filepath.Dir(s.FilePath), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(policies, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.FilePath, data, 0644)
}

type EnforcementClient interface {
	SetDevicePolicy(policy USBPolicy)
	RemoveDevicePolicy(deviceID string)
	GetStatus() string
}

type MockEnforcementClient struct{}

func (m *MockEnforcementClient) SetDevicePolicy(policy USBPolicy) {
	// Must not block files. Only log according to spec.
	allowPC := "DENY"
	if policy.AllowPCToUSB {
		allowPC = "ALLOW"
	}
	allowUSB := "DENY"
	if policy.AllowUSBToPC {
		allowUSB = "ALLOW"
	}
	logMessage("\n[MockEnforcementClient] Policy synchronized with future enforcement layer:\n  Device=%s\n  PC_TO_USB=%s\n  USB_TO_PC=%s\n  Status=%s\n  NO REAL FILE BLOCKING IMPLEMENTED YET.\n",
		policy.DriveLetter, allowPC, allowUSB, policy.Status)
}

func (m *MockEnforcementClient) RemoveDevicePolicy(deviceID string) {
	logMessage("\n[MockEnforcementClient] Policy removed for device: %s\n  NO REAL FILE BLOCKING IMPLEMENTED YET.\n", deviceID)
}

func (m *MockEnforcementClient) GetStatus() string {
	return "Mock Enforcement Client (Future Minifilter Interface)"
}

type LocalPolicyEngine struct {
	mu          sync.RWMutex
	policies    map[string]USBPolicy
	store       PolicyStore
	enforcement EnforcementClient
}

func NewLocalPolicyEngine(store PolicyStore, enforcement EnforcementClient) *LocalPolicyEngine {
	engine := &LocalPolicyEngine{
		policies:    make(map[string]USBPolicy),
		store:       store,
		enforcement: enforcement,
	}
	if p, err := store.Load(); err == nil {
		engine.policies = p
		for _, policy := range p {
			enforcement.SetDevicePolicy(policy)
		}
	}
	return engine
}

func GenerateDeviceID(driveLetter string) string {
	return "USB-" + strings.ToUpper(strings.TrimSuffix(driveLetter, "\\"))
}

func (e *LocalPolicyEngine) HandleUSBInsertion(driveLetter string) {
	e.mu.Lock()
	defer e.mu.Unlock()

	driveLetter = strings.ToUpper(driveLetter)
	deviceID := GenerateDeviceID(driveLetter)

	existing, exists := e.policies[driveLetter]
	
	if exists {
		now := time.Now()
		if existing.ExpiresAt != nil && now.After(*existing.ExpiresAt) {
			existing.Status = "EXPIRED"
			existing.AllowPCToUSB = false
			existing.AllowUSBToPC = false
			existing.UpdatedAt = now
			e.policies[driveLetter] = existing
			e.store.Save(e.policies)
			e.enforcement.SetDevicePolicy(existing)
		} else {
			e.enforcement.SetDevicePolicy(existing)
		}
		return
	}

	policy := USBPolicy{
		DeviceID:      deviceID,
		DriveLetter:   driveLetter,
		Status:        "PENDING",
		AllowPCToUSB:  false,
		AllowUSBToPC:  false,
		PolicyVersion: 1,
		UpdatedAt:     time.Now(),
	}

	e.policies[driveLetter] = policy
	e.store.Save(e.policies)
	e.enforcement.SetDevicePolicy(policy)
}

func (e *LocalPolicyEngine) HandleUSBRemoval(driveLetter string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	driveLetter = strings.ToUpper(driveLetter)
	deviceID := GenerateDeviceID(driveLetter)
	e.enforcement.RemoveDevicePolicy(deviceID)
}

func (e *LocalPolicyEngine) SetPolicy(policy USBPolicy) {
	e.mu.Lock()
	defer e.mu.Unlock()

	driveLetter := strings.ToUpper(policy.DriveLetter)
	
	existing, exists := e.policies[driveLetter]
	if exists && policy.PolicyVersion <= existing.PolicyVersion {
		return // Reject stale update
	}

	policy.UpdatedAt = time.Now()
	e.policies[driveLetter] = policy
	e.store.Save(e.policies)
	e.enforcement.SetDevicePolicy(policy)
}

func (e *LocalPolicyEngine) Evaluate(driveLetter string, direction Direction) Decision {
	e.mu.RLock()
	defer e.mu.RUnlock()

	driveLetter = strings.ToUpper(driveLetter)
	policy, exists := e.policies[driveLetter]
	
	if !exists {
		return Deny
	}

	if policy.ExpiresAt != nil && time.Now().After(*policy.ExpiresAt) {
		return Expired
	}

	if policy.Status == "EXPIRED" {
		return Expired
	}
	if policy.Status == "PENDING" {
		return Pending
	}
	if policy.Status == "DENIED" || policy.Status == "REVOKED" {
		return Deny
	}

	if policy.Status == "APPROVED" {
		if direction == PCToUSB && policy.AllowPCToUSB {
			return Allow
		}
		if direction == USBToPC && policy.AllowUSBToPC {
			return Allow
		}
		return Deny
	}

	return Deny
}

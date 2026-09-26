chrome.webNavigation.onCommitted.addListener((details) => {
  // Ignore iframe navigation
  if (details.frameId !== 0) return;

  const urlObj = new URL(details.url);

  const activity = {
    employee_id: "TEST-EMP-001",
    url: details.url,
    domain: urlObj.hostname,
    page_title: "", // Title is not always available in webNavigation, but we send the field
    timestamp: new Date().toISOString()
  };

  console.log("Browser activity detected:\n" + details.url);

  fetch("http://localhost:3001/api/browser-activity", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(activity)
  })
  .then(response => {
    if (!response.ok) {
      console.log(`Failed to send activity:\nBackend returned status ${response.status}`);
    }
  })
  .catch(error => {
    console.log(`Failed to send activity:\nBackend unavailable at http://localhost:3001`);
  });
});
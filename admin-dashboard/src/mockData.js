// Mock/placeholder data for pages that don't have a real multi-device backend
// yet (Employees directory, Org Overview, Website Monitoring). The one real
// device in this app (the signed-in user's own machine) is injected into
// these lists at render time in App.jsx — everything else here is a static
// stand-in for a future implementation.

export const MOCK_EMPLOYEES = [
  {
    id: 'emp-1',
    name: 'Rahul Sharma',
    role: 'Software Developer',
    department: 'Engineering',
    device: 'Rahul-PC',
    status: 'online',
    lastActive: '10 sec ago',
    events: 324,
    paths: 6,
  },
  {
    id: 'emp-2',
    name: 'Amit Shah',
    role: 'UI Designer',
    department: 'Design',
    device: 'Amit-PC',
    status: 'online',
    lastActive: '1 min ago',
    events: 182,
    paths: 4,
  },
  {
    id: 'emp-3',
    name: 'Priya Patil',
    role: 'HR Specialist',
    department: 'HR',
    device: 'Priya-PC',
    status: 'offline',
    lastActive: '25 min ago',
    events: 91,
    paths: 2,
  },
  {
    id: 'emp-4',
    name: 'Neha Gupta',
    role: 'Financial Analyst',
    department: 'Finance',
    device: 'Neha-MacBook',
    status: 'warning',
    lastActive: '5 min ago',
    events: 450,
    paths: 8,
  },
]

// Mock recent-activity rows shown on a mock employee's Device Detail page.
export const MOCK_ACTIVITY_BY_EMPLOYEE = {
  'emp-1': [
    { time: '12:18:30 am', type: 'DELETE', file: 'Screenshot 2026-07-25 182720.png', path: 'C:\\Users\\RAHUL\\Pictures\\Screenshots\\Screenshot 2026-07-25 182720.png' },
    { time: '12:18:30 am', type: 'DELETE', file: 'Screenshot 2026-07-25 203220.png', path: 'C:\\Users\\RAHUL\\Pictures\\Screenshots\\Screenshot 2026-07-25 203220.png' },
    { time: '12:18:30 am', type: 'DELETE', file: 'Screenshot 2026-07-25 215226.png', path: 'C:\\Users\\RAHUL\\Pictures\\Screenshots\\Screenshot 2026-07-25 215226.png' },
  ],
  'emp-2': [
    { time: '12:25:40 am', type: 'COPY', file: 'test_copy.txt', path: 'C:\\Users\\AMIT\\Desktop\\ITR\\ITR-Project-\\test_copy.txt' },
    { time: '12:27:37 am', type: 'COPY', file: 'test_copy_1.txt', path: 'C:\\Users\\AMIT\\Desktop\\ITR\\ITR-Project-\\test_copy_1.txt' },
  ],
  'emp-3': [
    { time: '12:17:55 am', type: 'CREATE', file: 'Screenshot 2026-08-27 001754.png', path: 'C:\\Users\\PRIYA\\Pictures\\Screenshots\\Screenshot 2026-08-27 001754.png' },
  ],
  'emp-4': [
    { time: '12:27:40 am', type: 'MODIFY', file: 'Q3-forecast.xlsx', path: 'C:\\Users\\NEHA\\Documents\\Finance\\Q3-forecast.xlsx' },
    { time: '12:27:43 am', type: 'COPY', file: 'test_copy_3.txt', path: 'C:\\Users\\NEHA\\Desktop\\ITR\\ITR-Project-\\test_copy_3.txt' },
  ],
}

export const MOCK_WEBSITE_STATS = {
  totalVisits: 1248,
  activeWebsites: 37,
  activeEmployees: 18,
  browsingTime: '42h 18m',
}

export const MOCK_WEBSITE_ACTIVITY = [
  { employee: 'Rahul Sharma', website: 'github.com', browser: 'Chrome', activity: 'active', time: '09:32', duration: '18 min' },
  { employee: 'Amit Shah', website: 'instagram.com', browser: 'Chrome', activity: 'active', time: '09:45', duration: '12 min' },
  { employee: 'Priya Patil', website: 'amazon.in', browser: 'Microsoft Edge', activity: 'idle', time: '10:03', duration: '8 min' },
  { employee: 'Neha Gupta', website: 'facebook.com', browser: 'Chrome', activity: 'active', time: '10:18', duration: '24 min' },
  { employee: 'Vikram Singh', website: 'youtube.com', browser: 'Chrome', activity: 'visited', time: '10:42', duration: '35 min' },
  { employee: 'Neha Gupta', website: 'stackoverflow.com', browser: 'Chrome', activity: 'visited', time: '13:02', duration: '11 min' },
  { employee: 'Vikram Singh', website: 'twitter.com', browser: 'Chrome', activity: 'active', time: '13:15', duration: '7 min' },
  { employee: 'Priya Patil', website: 'slack.com', browser: 'Microsoft Edge', activity: 'active', time: '13:25', duration: '9 min' },
]

export const MOCK_RECENT_WEBSITE_ACTIVITY = [
  { employee: 'Rahul Sharma', action: 'opened', site: 'github.com', time: '20 min ago' },
  { employee: 'Amit Shah', action: 'opened', site: 'instagram.com', time: '23 min ago' },
  { employee: 'Priya Patil', action: 'opened', site: 'amazon.in', time: '27 min ago' },
  { employee: 'Neha Gupta', action: 'opened', site: 'facebook.com', time: '32 min ago' },
  { employee: 'Vikram Singh', action: 'opened', site: 'youtube.com', time: '48 min ago' },
  { employee: 'Rahul Sharma', action: 'opened', site: 'stackoverflow.com', time: '1 hr ago' },
  { employee: 'Amit Shah', action: 'opened', site: 'twitter.com', time: '1 hr ago' },
]

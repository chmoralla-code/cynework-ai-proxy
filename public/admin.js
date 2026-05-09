const adminLoginPanel = document.getElementById('adminLoginPanel');
const adminDataPanel = document.getElementById('adminDataPanel');
const subscriptionPanel = document.getElementById('subscriptionPanel');
const adminLoginForm = document.getElementById('adminLoginForm');
const clientsTable = document.getElementById('clientsTable');
const requestsTable = document.getElementById('requestsTable');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
};

const setLoggedInUI = (isLoggedIn) => {
  adminLoginPanel.style.display = isLoggedIn ? 'none' : 'block';
  adminDataPanel.style.display = isLoggedIn ? 'block' : 'none';
  subscriptionPanel.style.display = isLoggedIn ? 'block' : 'none';
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const renderClients = (clients) => {
  const header = `
    <tr>
      <th style="text-align:left;padding:8px;border-bottom:1px solid #303760;">Email</th>
      <th style="text-align:left;padding:8px;border-bottom:1px solid #303760;">Plan</th>
      <th style="text-align:left;padding:8px;border-bottom:1px solid #303760;">Status</th>
      <th style="text-align:left;padding:8px;border-bottom:1px solid #303760;">Actions</th>
    </tr>`;
  const rows = clients.map((client) => `
    <tr data-user-id="${escapeHtml(client.id)}">
      <td style="padding:8px;border-bottom:1px solid #23284a;">${escapeHtml(client.email)}</td>
      <td style="padding:8px;border-bottom:1px solid #23284a;">
        <select class="plan-select">
          ${['free', 'daily', 'monthly', 'yearly'].map((plan) => `<option value="${plan}" ${client.plan === plan ? 'selected' : ''}>${plan}</option>`).join('')}
        </select>
      </td>
      <td style="padding:8px;border-bottom:1px solid #23284a;">
        <select class="status-select">
          <option value="active" ${client.plan_status === 'active' ? 'selected' : ''}>active</option>
          <option value="inactive" ${client.plan_status !== 'active' ? 'selected' : ''}>inactive</option>
        </select>
      </td>
      <td style="padding:8px;border-bottom:1px solid #23284a;">
        <button class="ghost-btn save-plan-btn">Save</button>
        <button class="ghost-btn delete-user-btn" style="border-color:#ef4444;color:#ef4444;">Delete</button>
      </td>
    </tr>
  `).join('');
  const emptyRow = `<tr><td colspan="4" style="padding:12px;color:#b5aea3;">No registered clients yet.</td></tr>`;
  clientsTable.innerHTML = header + (rows || emptyRow);
};

const renderRequests = (requests) => {
  const header = `
    <tr>
      <th style="text-align:left;padding:8px;border-bottom:1px solid #303760;">User</th>
      <th style="text-align:left;padding:8px;border-bottom:1px solid #303760;">Plan</th>
      <th style="text-align:left;padding:8px;border-bottom:1px solid #303760;">Amount</th>
      <th style="text-align:left;padding:8px;border-bottom:1px solid #303760;">Status</th>
      <th style="text-align:left;padding:8px;border-bottom:1px solid #303760;">Action</th>
    </tr>`;
  const rows = requests.map((request) => `
    <tr data-request-id="${escapeHtml(request.id)}">
      <td style="padding:8px;border-bottom:1px solid #23284a;">${escapeHtml(request.user_id)}</td>
      <td style="padding:8px;border-bottom:1px solid #23284a;">${escapeHtml(request.plan)}</td>
      <td style="padding:8px;border-bottom:1px solid #23284a;">₱${escapeHtml(request.amount_php)}</td>
      <td style="padding:8px;border-bottom:1px solid #23284a;">${escapeHtml(request.status)}</td>
      <td style="padding:8px;border-bottom:1px solid #23284a;">
        <button class="ghost-btn approve-request-btn">Approve</button>
        <button class="ghost-btn reject-request-btn">Reject</button>
      </td>
    </tr>
  `).join('');
  const emptyRow = `<tr><td colspan="5" style="padding:12px;color:#b5aea3;">No subscription requests yet.</td></tr>`;
  requestsTable.innerHTML = header + (rows || emptyRow);
};

const loadAdminData = async () => {
  const [clientsData, requestsData] = await Promise.all([
    fetchJson('/chat/admin/clients'),
    fetchJson('/chat/admin/subscription-requests')
  ]);
  renderClients(clientsData.clients || []);
  renderRequests(requestsData.requests || []);
};

adminLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('adminUsername').value.trim();
  const password = document.getElementById('adminPassword').value;
  try {
    await fetchJson('/chat/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    setLoggedInUI(true);
    await loadAdminData();
  } catch (error) {
    alert(error.message);
  }
});

adminLogoutBtn.addEventListener('click', async () => {
  try {
    await fetchJson('/chat/admin/logout', { method: 'POST' });
  } finally {
    setLoggedInUI(false);
  }
});

clientsTable.addEventListener('click', async (e) => {
  const row = e.target.closest('tr[data-user-id]');
  if (!row) return;
  const userId = row.dataset.userId;

  if (e.target.classList.contains('delete-user-btn')) {
    if (!confirm('Delete this account permanently?')) return;
    try {
      await fetchJson(`/chat/admin/clients/${userId}`, { method: 'DELETE' });
      await loadAdminData();
    } catch (error) {
      alert(error.message);
    }
  }

  if (e.target.classList.contains('save-plan-btn')) {
    const plan = row.querySelector('.plan-select').value;
    const planStatus = row.querySelector('.status-select').value;
    try {
      await fetchJson(`/chat/admin/clients/${userId}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({ plan, planStatus })
      });
      await loadAdminData();
    } catch (error) {
      alert(error.message);
    }
  }
});

requestsTable.addEventListener('click', async (e) => {
  const row = e.target.closest('tr[data-request-id]');
  if (!row) return;
  const requestId = row.dataset.requestId;

  const status = e.target.classList.contains('approve-request-btn') ? 'approved' :
    e.target.classList.contains('reject-request-btn') ? 'rejected' : null;
  if (!status) return;

  try {
    await fetchJson(`/chat/admin/subscription-requests/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    await loadAdminData();
  } catch (error) {
    alert(error.message);
  }
});

const bootstrap = async () => {
  try {
    await fetchJson('/chat/admin/me');
    setLoggedInUI(true);
    await loadAdminData();
  } catch {
    setLoggedInUI(false);
  }
};

bootstrap();

const adminMoney = value => `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const adminStatuses = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    preparing: 'Preparing',
    out_for_delivery: 'Out for delivery',
    completed: 'Delivered',
    cancelled: 'Cancelled'
};
const deliveryNextSteps = {
    pending: {
        status: 'confirmed',
        label: 'Confirm'
    },
    confirmed: {
        status: 'preparing',
        label: 'Start preparing'
    },
    preparing: {
        status: 'out_for_delivery',
        label: 'Out for delivery'
    },
};
const escapeAdmin = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;'
} [character]));

function wireAdminLogoutConfirmation() {
    const logoutLinks = document.querySelectorAll('.aside-footer .logout');
    if (!logoutLinks.length) return;

    const modal = document.createElement('div');
    modal.className = 'admin-logout-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'adminLogoutTitle');
    modal.setAttribute('aria-describedby', 'adminLogoutMessage');
    modal.innerHTML = `
        <div class="admin-logout-card">
            <h2 id="adminLogoutTitle">Log out?</h2>
            <p id="adminLogoutMessage">Are you sure you want to log out of your account?</p>
            <form method="post" class="admin-logout-actions">
                <button type="button" class="admin-logout-cancel">Cancel</button>
                <button type="submit" class="admin-logout-confirm">Confirm</button>
            </form>
        </div>`;
    document.body.appendChild(modal);

    const form = modal.querySelector('form');
    const cancelButton = modal.querySelector('.admin-logout-cancel');
    let activeLogoutLink = null;

    const closeModal = () => {
        modal.classList.remove('open');
        if (activeLogoutLink) activeLogoutLink.focus();
    };

    logoutLinks.forEach(link => {
        link.setAttribute('aria-haspopup', 'dialog');
        link.addEventListener('click', event => {
            event.preventDefault();
            activeLogoutLink = link;
            form.action = link.href;
            modal.classList.add('open');
            cancelButton.focus();
        });
    });

    cancelButton.addEventListener('click', closeModal);
    modal.addEventListener('click', event => {
        if (event.target === modal) closeModal();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && modal.classList.contains('open')) closeModal();
    });
}

async function loadSupportTickets() {
    const container = document.getElementById('supportTicketsList');
    if (!container) return;

    try {
        const response = await rsmApi('admin_support_tickets.php');
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Could not load support tickets.');
        }

        if (!Array.isArray(data.tickets) || data.tickets.length === 0) {
            container.innerHTML = '<p class="empty">No support tickets have been submitted yet.</p>';
            return;
        }

        const statusOptions = ['open', 'in_progress', 'pending_customer', 'resolved', 'closed'];
        container.innerHTML = data.tickets.map(ticket => {
            const createdAt = new Date(ticket.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
            const status = String(ticket.status || 'open');
            return `
                <article class="support-ticket-row">
                    <div class="support-ticket-meta">
                        <span>#${ticket.ticket_id}</span>
                        <span>${escapeAdmin(ticket.username || 'Customer')}</span>
                        <span>${escapeAdmin(ticket.branch || 'Branch')}</span>
                        <span>${createdAt}</span>
                    </div>
                    <strong>${escapeAdmin(ticket.subject || 'Untitled ticket')}</strong>
                    <div class="support-ticket-meta">
                        <span class="support-ticket-status ${status}">${formatSupportStatus(status)}</span>
                        <span class="support-ticket-priority ${ticket.priority || 'medium'}">${formatSupportPriority(ticket.priority || 'medium')}</span>
                        <span>${escapeAdmin(ticket.category || 'Other')}</span>
                    </div>
                    <div class="support-ticket-meta">
                        <span>${escapeAdmin(ticket.email || 'No email')}</span>
                    </div>
                    <div class="support-ticket-message">${escapeAdmin(ticket.message || '')}</div>
                    <label>
                        <span class="sr-only">Update ticket status</span>
                        <select data-support-ticket-status data-ticket-id="${ticket.ticket_id}" aria-label="Update ticket status">
                            ${statusOptions.map(option => `<option value="${option}" ${option === status ? 'selected' : ''}>${formatSupportStatus(option)}</option>`).join('')}
                        </select>
                    </label>
                </article>
            `;
        }).join('');

        container.querySelectorAll('[data-support-ticket-status]').forEach(select => {
            select.addEventListener('change', async (event) => {
                const target = event.target;
                const ticketId = Number(target.dataset.ticketId) || 0;
                const status = target.value;
                try {
                    const response = await rsmApi('admin_support_tickets.php', {
                        method: 'POST',
                        body: { ticket_id: ticketId, status },
                    });
                    const data = await response.json();
                    if (!response.ok || !data.success) {
                        throw new Error(data.message || 'Could not update the ticket status.');
                    }
                    await loadSupportTickets();
                } catch (error) {
                    const feedback = document.getElementById('supportTicketsList');
                    if (feedback) {
                        feedback.insertAdjacentHTML('beforeend', `<p class="empty">${escapeAdmin(error.message || 'Could not update the ticket.')}</p>`);
                    }
                }
            });
        });
    } catch (error) {
        container.innerHTML = `<p class="empty">${escapeAdmin(error.message || 'Support tickets are unavailable.')}</p>`;
    }
}

function formatSupportStatus(value) {
    return String(value || 'Open').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function formatSupportPriority(value) {
    return String(value || 'Medium').charAt(0).toUpperCase() + String(value || 'Medium').slice(1);
}

function normalizeAdminNavigation() {
    const nav = document.querySelector('.shell > aside > nav');
    if (!nav) return;

    const expectedOrder = [
        'admin_dashboard.html',
        'admin_sales.html',
        'admin_inventory.html',
        'admin_forecasting.html',
        'admin_performance.html',
        'admin_gcash.html',
        'staff_accounts.html',
    ];
    const linksByPage = new Map();

    nav.querySelectorAll('a').forEach(link => {
        const href = link.getAttribute('href') || '';
        const page = href.endsWith('admin_delivery.html') ? 'staff_accounts.html' : href.split(/[?#]/, 1)[0];
        if (page === 'staff_accounts.html') {
            link.setAttribute('href', 'staff_accounts.html');
            link.textContent = 'Staff accounts';
        }
        if (expectedOrder.includes(page) && !linksByPage.has(page)) {
            linksByPage.set(page, link);
        }
    });

    if (!linksByPage.has('admin_gcash.html')) {
        const link = document.createElement('a');
        link.href = 'admin_gcash.html';
        link.textContent = 'GCash';
        linksByPage.set('admin_gcash.html', link);
    }

    const currentPage = location.pathname
        .replace(/\/+$/, '')
        .split('/')
        .pop()
        .replace(/\.html$/i, '')
        .toLowerCase();

    expectedOrder.forEach(page => {
        const link = linksByPage.get(page);
        if (link) {
            link.classList.toggle('active', currentPage === page.replace(/\.html$/i, '').toLowerCase());
            nav.appendChild(link);
        }
    });
}

normalizeAdminNavigation();
wireAdminLogoutConfirmation();

(async function loadAdminPage() {
    const page = location.pathname.endsWith('admin_dashboard.html') ? 'overview' : document.body.dataset.page;
    if (page === 'delivery') {
        window.location.replace('staff_accounts.html');
        return;
    }
    const reportDate = document.getElementById('reportDate');
    if (reportDate) reportDate.textContent = new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
    if (page === 'staff_accounts') {
        try {
            await loadAdminStockNotifications();
        } catch (error) {
            document.getElementById('pageMessage').textContent = error.message || 'Stock notifications are unavailable.';
        }
        await setupStaffAccounts();
        return;
    }
    try {
        const response = await rsmApi('admin_dashboard_data.php');
        const data = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!data.success) throw new Error(data.message);
        renderAdminStockNotifications(data.products);
        const adminName = document.getElementById('adminName');
        if (adminName) adminName.textContent = data.admin.name || 'Admin';
        document.getElementById('adminGreeting').textContent = `Signed in as ${data.admin.name || 'administrator'} · ${data.branch === 'all' ? 'All branches' : data.branch}`;
        setupAdminBranchFilter(data.branch || 'all');
        if (page === 'overview') {
            await loadSupportTickets();
            renderOverview(data);
        }
        if (page === 'inventory') await loadInventory();
        if (page === 'forecasting') await setupForecastDashboard(data.branch || 'all');
        if (page === 'sales') await loadSales();
        if (page === 'delivery') await setupDeliveryQueue();
        if (page === 'performance') renderPerformance(data);
        if (page === 'gcash') await setupAdminGcash();
    } catch (error) {
        document.getElementById('pageMessage').textContent = error.message || 'Dashboard data is unavailable.';
    }
})();

async function setupAdminGcash() {
    const form = document.getElementById('gcashSettingsForm');
    const message = document.getElementById('gcashSettingsMessage');
    const qrPreview = document.getElementById('gcashQrPreview');
    const qrImage = document.getElementById('gcashQrImage');
    const removeQr = document.getElementById('removeGcashQr');

    const renderSettings = settings => {
        form.elements.mobile_number.value = settings.mobile_number || '';
        if (settings.qr_url) {
            qrImage.src = settings.qr_url;
            qrPreview.hidden = false;
            removeQr.disabled = false;
        } else {
            qrImage.removeAttribute('src');
            qrPreview.hidden = true;
            removeQr.checked = false;
            removeQr.disabled = true;
        }
    };

    try {
        const response = await rsmApi('admin_gcash_settings.php');
        const settings = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!settings.success) throw new Error(settings.message || 'Could not load GCash details.');
        renderSettings(settings);
    } catch (error) {
        message.textContent = error.message || 'Could not load GCash details.';
        message.className = 'form-message error';
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const submitButton = form.querySelector('[type="submit"]');
        const payload = new FormData(form);
        const qrFile = form.elements.gcash_qr.files[0];
        payload.set('remove_qr', removeQr.checked && !(qrFile && qrFile.size) ? 'true' : 'false');
        submitButton.disabled = true;
        message.textContent = 'Saving GCash details...';
        message.className = 'form-message';
        try {
            const response = await rsmApi('admin_gcash_settings.php', { method: 'POST', body: payload });
            const result = await response.json();
            if (response.status === 401) {
                window.location.href = 'Admin_login.html';
                return;
            }
            if (!result.success) throw new Error(result.message || 'Could not save GCash details.');
            renderSettings(result);
            form.elements.gcash_qr.value = '';
            removeQr.checked = false;
            message.textContent = result.message || 'GCash details saved.';
            message.className = 'form-message success';
        } catch (error) {
            message.textContent = error.message || 'Could not save GCash details.';
            message.className = 'form-message error';
        } finally {
            submitButton.disabled = false;
        }
    });
}

function setupAdminBranchFilter(selectedBranch) {
    const filter = document.getElementById('adminBranchFilter');
    if (!filter) return;
    filter.value = selectedBranch;
    filter.addEventListener('change', async () => {
        const status = document.getElementById('adminBranchFilterStatus');
        filter.disabled = true;
        status.textContent = 'Updating branch view...';
        try {
            const response = await rsmApi('admin_branch_context_set.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    branch: filter.value
                }),
            });
            const result = await response.json();
            if (response.status === 401) {
                window.location.href = 'Admin_login.html';
                return;
            }
            if (!result.success) throw new Error(result.message || 'Could not change branch.');
            window.location.reload();
        } catch (error) {
            status.textContent = error.message || 'Could not change branch.';
            filter.disabled = false;
        }
    });
}

function renderAdminStockNotifications(products) {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;

    let actions = topbar.querySelector('.admin-topbar-actions');
    if (!actions) {
        actions = document.createElement('div');
        actions.className = 'admin-topbar-actions';
        const dateChip = topbar.querySelector('.date-chip');
        if (dateChip) actions.appendChild(dateChip);
        topbar.appendChild(actions);
    }

    const lowStock = (Array.isArray(products) ? products : [])
        .filter(product => (product.is_active === undefined || Number(product.is_active) === 1) && Number(product.stock_qty) <= 10)
        .sort((first, second) => Number(first.stock_qty) - Number(second.stock_qty));
    let notifications = actions.querySelector('.admin-stock-notifications');
    if (!notifications) {
        notifications = document.createElement('div');
        notifications.className = 'admin-stock-notifications';
        notifications.innerHTML = `
            <button class="admin-notification-button" type="button" aria-label="Low stock notifications" aria-expanded="false" aria-controls="adminStockNotificationPanel">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path></svg>
                <span class="admin-notification-count" hidden></span>
            </button>
            <section class="admin-notification-panel" id="adminStockNotificationPanel" aria-label="Low stock items" hidden></section>`;
        actions.appendChild(notifications);

        const button = notifications.querySelector('.admin-notification-button');
        const panel = notifications.querySelector('.admin-notification-panel');
        const closePanel = () => {
            panel.hidden = true;
            button.setAttribute('aria-expanded', 'false');
        };
        button.addEventListener('click', () => {
            const isOpen = button.getAttribute('aria-expanded') === 'true';
            panel.hidden = isOpen;
            button.setAttribute('aria-expanded', String(!isOpen));
        });
        document.addEventListener('click', event => {
            if (!notifications.contains(event.target)) closePanel();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closePanel();
        });
    }

    const button = notifications.querySelector('.admin-notification-button');
    const badge = notifications.querySelector('.admin-notification-count');
    const panel = notifications.querySelector('.admin-notification-panel');
    button.setAttribute('aria-label', `Low stock notifications: ${lowStock.length}`);
    badge.textContent = lowStock.length > 99 ? '99+' : String(lowStock.length);
    badge.hidden = lowStock.length === 0;
    panel.innerHTML = `
        <h3>Low stock${lowStock.length ? ` · ${lowStock.length}` : ''}</h3>
        ${lowStock.length
            ? `<ul>${lowStock.map(product => `<li><span>${escapeAdmin(product.product_name)}</span><strong>${Number(product.stock_qty)} left</strong></li>`).join('')}</ul>`
            : '<p class="admin-notification-empty">No low-stock items right now.</p>'}
        <a href="admin_inventory.html">View inventory</a>`;
}

async function loadAdminStockNotifications() {
    const response = await rsmApi('admin_dashboard_data.php');
    const data = await response.json();
    if (response.status === 401) {
        window.location.href = 'Admin_login.html';
        return;
    }
    if (!data.success) throw new Error(data.message || 'Could not load stock notifications.');
    renderAdminStockNotifications(data.products);
}

async function setupStaffAccounts() {
    document.getElementById('staffCreateForm').addEventListener('submit', createStaffAccount);
    document.getElementById('refreshStaffButton').addEventListener('click', loadStaffAccounts);
    await loadStaffAccounts();
}

async function loadStaffAccounts() {
    const target = document.getElementById('staffAccountsTable');
    target.innerHTML = '<p class="empty">Loading staff accounts...</p>';
    try {
        const response = await rsmApi('admin_staff.php');
        const data = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!data.success) throw new Error(data.message || 'Could not load staff accounts.');
        const name = data.admin.name || 'administrator';
        document.getElementById('adminGreeting').textContent = `Signed in as ${name} · ${data.branch === 'all' ? 'All branches' : data.branch}`;
        const branchField = document.querySelector('#staffCreateForm [name="branch"]');
        if (!branchField) throw new Error('The staff branch field is missing.');
        if (data.branch !== 'all') {
            branchField.value = data.branch;
            branchField.disabled = true;
        } else {
            branchField.disabled = false;
        }
        renderStaffAccounts(data.staff || []);
    } catch (error) {
        target.innerHTML = `<p class="empty">${escapeAdmin(error.message || 'Could not load staff accounts.')}</p>`;
    }
}

function renderStaffAccounts(staff) {
    const target = document.getElementById('staffAccountsTable');
    if (!staff.length) {
        target.innerHTML = '<p class="empty">No staff accounts yet. Create the first account above.</p>';
        return;
    }

    target.innerHTML = `<div class="table-scroll"><table class="staff-accounts-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Branch</th><th>Status</th><th>Access</th></tr></thead>
        <tbody>${staff.map(account => {
            const active = Number(account.is_active) === 1;
            const role = account.role === 'sales' ? 'Sales staff' : 'Delivery staff';
            return `<tr>
                <td><strong>${escapeAdmin(account.full_name)}</strong></td>
                <td>${escapeAdmin(account.email)}</td>
                <td>${role}</td>
                <td>${escapeAdmin(account.branch)}</td>
                <td><span class="staff-status ${active ? 'active' : 'disabled'}">${active ? 'Active' : 'Disabled'}</span></td>
                <td class="staff-account-actions">
                    <button type="button" class="text-button" data-staff-action="toggle" data-staff-id="${Number(account.staff_id)}">${active ? 'Disable' : 'Enable'}</button>
                    <button type="button" class="text-button danger" data-staff-action="delete" data-staff-id="${Number(account.staff_id)}">Delete</button>
                </td>
            </tr>`;
        }).join('')}</tbody>
    </table></div>`;

    target.querySelectorAll('[data-staff-action]').forEach(button => {
        button.addEventListener('click', () => manageStaffAccount(button.dataset.staffId, button.dataset.staffAction));
    });
}

async function createStaffAccount(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById('staffFormMessage');
    const submit = form.querySelector('[type="submit"]');
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.action = 'create';
    payload.branch = form.elements.branch.value;
    submit.disabled = true;
    message.textContent = '';
    try {
        const response = await rsmApi('admin_staff.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!result.success) throw new Error(result.message || 'Could not create staff account.');
        form.reset();
        message.textContent = result.message;
        message.className = 'form-message success';
        await loadStaffAccounts();
    } catch (error) {
        message.textContent = error.message || 'Could not create staff account.';
        message.className = 'form-message';
    } finally {
        submit.disabled = false;
    }
}

async function manageStaffAccount(staffId, action) {
    if (action === 'delete' && !window.confirm('Permanently delete this staff account? Its name and email will be available for reuse.')) return;
    try {
        const response = await rsmApi('admin_staff.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action,
                staff_id: staffId
            }),
        });
        const result = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!result.success) throw new Error(result.message || 'Could not update staff account.');
        showToast(result.message);
        await loadStaffAccounts();
    } catch (error) {
        document.getElementById('pageMessage').textContent = error.message || 'Could not update staff account.';
    }
}

let inventoryProducts = [];
let inventoryEventsBound = false;
let inventoryBranch = 'all';
async function loadInventory() {
    const response = await rsmApi('admin_products.php');
    const data = await response.json();
    if (response.status === 401) {
        window.location.href = 'Admin_login.html';
        return;
    }
    if (!data.success) throw new Error(data.message || 'Could not load products.');
    const productSubmit = document.getElementById('productSubmit');
    const productForm = document.getElementById('productForm');
    const formMessage = document.getElementById('formMessage');
    inventoryBranch = data.branch || 'all';
    productSubmit.disabled = inventoryBranch === 'all';
    productForm.querySelectorAll('input:not([type="hidden"]), textarea').forEach(field => {
        field.disabled = inventoryBranch === 'all';
    });
    if (data.branch === 'all') {
        formMessage.textContent = 'All-branches view is read-only. Select a branch to edit its stock.';
    } else if (formMessage.textContent === 'All-branches view is read-only. Select a branch to edit its stock.') {
        formMessage.textContent = '';
    }
    inventoryProducts = data.products;
    renderAdminStockNotifications(inventoryProducts);
    if (!inventoryEventsBound) {
        document.getElementById('inventoryFilter').addEventListener('change', event => drawInventory(event.target.value));
        document.getElementById('productForm').addEventListener('submit', saveProduct);
        document.getElementById('cancelEdit').addEventListener('click', resetProductForm);
        inventoryEventsBound = true;
    }
    drawInventory();
}

function drawInventory(filter = document.getElementById('inventoryFilter').value) {
    const normalizedFilter = ['low', 'healthy', 'archived'].includes(filter) ? filter : 'all';
    const rows = inventoryProducts.filter(product => {
        const active = Number(product.is_active) === 1;
        if (normalizedFilter === 'archived') return !active;
        return active && (normalizedFilter === 'all' || (normalizedFilter === 'low' && Number(product.stock_qty) <= 10) || (normalizedFilter === 'healthy' && Number(product.stock_qty) > 10));
    });
    document.getElementById('inventoryTable').innerHTML = rows.length ? `<div class="table-scroll"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(product => {
        const active = Number(product.is_active) === 1;
        const status = active ? (Number(product.stock_qty) <= 10 ? 'Restock soon' : 'Healthy') : 'Archived';
        const actions = inventoryBranch === 'all' ? '—' : active
            ? `<button type="button" class="text-button" data-edit="${product.product_id}">Edit</button><button type="button" class="text-button archive" data-archive="${product.product_id}">Archive</button>`
            : `<button type="button" class="text-button" data-unarchive="${product.product_id}">Unarchive</button>`;
        return `<tr class="${Number(product.stock_qty) <= 10 && active ? 'stock-low' : ''}"><td><strong>${escapeAdmin(product.product_name)}</strong>${product.description ? `<small class="product-description">${escapeAdmin(product.description)}</small>` : ''}</td><td>${escapeAdmin(product.category_name || 'Uncategorised')}</td><td>${adminMoney(product.price)}</td><td class="stock-count">${product.stock_qty}</td><td>${status}</td><td class="product-actions">${actions}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<p class="empty">No products match this filter.</p>';
    document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => editProduct(button.dataset.edit)));
    document.querySelectorAll('[data-archive]').forEach(button => button.addEventListener('click', () => manageProductArchive(button.dataset.archive, 'archive')));
    document.querySelectorAll('[data-unarchive]').forEach(button => button.addEventListener('click', () => manageProductArchive(button.dataset.unarchive, 'unarchive')));
}

function editProduct(id) {
    if (inventoryBranch === 'all') return;
    const product = inventoryProducts.find(item => String(item.product_id) === String(id));
    if (!product) return;
    const form = document.getElementById('productForm');
    for (const field of ['product_id', 'product_name', 'category_name', 'price', 'stock_qty', 'description']) form.elements[field].value = product[field] ?? '';
    document.getElementById('productFormTitle').textContent = 'Update product';
    document.getElementById('productSubmit').textContent = 'Save changes';
    document.getElementById('cancelEdit').hidden = false;
    form.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
}

function resetProductForm() {
    document.getElementById('productForm').reset();
    document.getElementById('productForm').elements.product_id.value = '';
    document.getElementById('productFormTitle').textContent = 'Add a product';
    document.getElementById('productSubmit').textContent = 'Add product';
    document.getElementById('cancelEdit').hidden = true;
    document.getElementById('formMessage').textContent = '';
}

async function saveProduct(event) {
    event.preventDefault();
    if (inventoryBranch === 'all') {
        document.getElementById('formMessage').textContent = 'Select one branch before changing its inventory.';
        return;
    }
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.action = payload.product_id ? 'update' : 'create';
    try {
        const response = await rsmApi('admin_products.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!result.success) throw new Error(result.message);
        resetProductForm();
        await loadInventory();
        showToast(result.message);
    } catch (error) {
        document.getElementById('formMessage').textContent = error.message || 'Could not save product.';
    }
}

async function manageProductArchive(productId, action) {
    if (action === 'archive' && !window.confirm('Archive this product? It will be removed from all products until it is unarchived.')) return;
    try {
        const response = await rsmApi('admin_products.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action, product_id: productId })
        });
        const result = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!result.success) throw new Error(result.message || `Could not ${action} product.`);
        document.getElementById('inventoryFilter').value = action === 'archive' ? 'archived' : 'all';
        await loadInventory();
        showToast(result.message);
    } catch (error) {
        document.getElementById('pageMessage').textContent = error.message || `Could not ${action} product.`;
    }
}

function renderOverview(data) {
    renderDecisionSupport(data);
    loadOverviewBranchInsight(data.branch);
    setupOverviewDateFilter();
}

let overviewAnalyticsRequest = 0;
const overviewLowStockThreshold = 10;

function setupOverviewDateFilter() {
    const selection = setupAdminDateFilter('overviewDateFilter', loadOverviewAnalytics);
    if (selection) loadOverviewAnalytics(selection.period, selection.date);
}

function setupAdminDateFilter(formId, onApply) {
    const form = document.getElementById(formId);
    if (!form) return null;

    const period = form.querySelector('[data-period]');
    const day = form.querySelector('[data-day]');
    const month = form.querySelector('[data-month]');
    const year = form.querySelector('[data-year]');
    const params = new URLSearchParams(location.search);
    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const savedDate = params.get('date') || todayString;
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(savedDate) && !Number.isNaN(new Date(`${savedDate}T00:00:00`).getTime()) ?
        savedDate : todayString;
    period.value = ['day', 'month', 'year'].includes(params.get('period')) ? params.get('period') : 'day';
    day.value = validDate;
    month.value = validDate.slice(0, 7);
    year.value = validDate.slice(0, 4);

    const updateInput = () => {
        day.hidden = period.value !== 'day';
        day.disabled = period.value !== 'day';
        month.hidden = period.value !== 'month';
        month.disabled = period.value !== 'month';
        year.hidden = period.value !== 'year';
        year.disabled = period.value !== 'year';
    };
    const selectedDate = () => period.value === 'day' ? day.value :
        period.value === 'month' ? `${month.value}-01` :
        `${year.value}-01-01`;
    const syncDateNavigation = () => {
        document.querySelectorAll('.shell > aside > nav a[href]').forEach(link => {
            const target = new URL(link.href, location.href);
            if (!['admin_dashboard.html', 'admin_sales.html', 'admin_performance.html'].includes(target.pathname.split('/').pop())) return;
            target.searchParams.set('period', period.value);
            target.searchParams.set('date', selectedDate());
            link.href = target.href;
        });
    };

    updateInput();
    syncDateNavigation();
    if (form.dataset.dateFilterBound !== 'true') {
        period.addEventListener('change', updateInput);
        form.addEventListener('submit', event => {
            event.preventDefault();
            const activeInput = period.value === 'day' ? day : period.value === 'month' ? month : year;
            if (!activeInput.value || !activeInput.checkValidity()) {
                activeInput.reportValidity();
                return;
            }
            const date = selectedDate();
            const query = new URLSearchParams(location.search);
            query.set('period', period.value);
            query.set('date', date);
            history.replaceState(null, '', `${location.pathname}?${query}`);
            syncDateNavigation();
            onApply(period.value, date);
        });
        form.dataset.dateFilterBound = 'true';
    }

    return { period: period.value, date: selectedDate() };
}

async function loadOverviewAnalytics(period, date) {
    const status = document.getElementById('overviewFilterStatus');
    const form = document.getElementById('overviewDateFilter');
    const apply = form.querySelector('.overview-date-apply');
    const request = ++overviewAnalyticsRequest;
    apply.disabled = true;
    status.textContent = 'Loading analytics...';
    try {
        const query = new URLSearchParams({ period, date });
        const response = await rsmApi(`admin_overview_analytics.php?${query}`);
        const data = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!data.success) throw new Error(data.message || 'Could not load overview analytics.');
        if (request !== overviewAnalyticsRequest) return;
        renderRevenueChart(data.daily_revenue || [], period, date);
        renderOrderStatusChart(data.monthly_statuses || [], period);
        renderTopProducts(data.top_products || [], period);
        const periodLabel = period === 'day' ? 'selected day' : period === 'month' ? 'selected month' : 'selected year';
        document.getElementById('revenuePeriodNote').textContent = `${period === 'year' ? 'Monthly' : 'Daily'} sales · ${periodLabel}`;
        document.getElementById('orderStatusPeriodNote').textContent = periodLabel;
        document.getElementById('topProductsPeriodNote').textContent = `Units sold · ${periodLabel}`;
        if (!data.kpis || !Array.isArray(data.branch_sales) ||
            !Array.isArray(data.inventory_stock) || !Array.isArray(data.daily_orders)) {
            throw new Error('Dashboard analytics are not installed in Supabase yet. Run the updated Database.sql, then reload this page.');
        }
        renderOverviewKpis(data.kpis || {});
        renderBranchSalesChart(data.branch_sales || [], period);
        renderInventoryStockChart(data.inventory_stock || []);
        renderDailyOrderTrend(data.daily_orders || [], period, date);
        document.querySelector('.overview-dashboard-panel > .panel-head .panel-note').textContent =
            `Completed sales and customer order activity for the ${periodLabel}; inventory shows current stock across all branches.`;
        document.getElementById('branchSalesPeriodNote').textContent = `Completed revenue · ${periodLabel} · all branches`;
        status.textContent = '';
    } catch (error) {
        if (request === overviewAnalyticsRequest) {
            const message = error.message || 'Overview analytics are unavailable.';
            status.textContent = message;
            ['branchSalesChart', 'inventoryStockChart', 'dailyOrdersChart'].forEach(id => {
                document.getElementById(id).innerHTML = `<p class="empty">${escapeAdmin(message)}</p>`;
            });
        }
    } finally {
        if (request === overviewAnalyticsRequest) apply.disabled = false;
    }
}

function renderOverviewKpis(kpis) {
    document.getElementById('overviewTotalRevenue').textContent = adminMoney(kpis.total_revenue);
    document.getElementById('overviewTotalOrders').textContent = Number(kpis.total_orders || 0).toLocaleString();
    document.getElementById('overviewProductsSold').textContent = Number(kpis.products_sold || 0).toLocaleString();
    document.getElementById('overviewLowStockProducts').textContent = Number(kpis.low_stock_products || 0).toLocaleString();
    document.getElementById('overviewCompletedOrders').textContent = Number(kpis.completed_orders || 0).toLocaleString();
    document.getElementById('overviewPendingPayments').textContent = Number(kpis.pending_payments || 0).toLocaleString();
    document.getElementById('overviewBestBranch').textContent = kpis.best_performing_branch || 'No sales';
    document.getElementById('overviewBestBranchRevenue').textContent =
        Number(kpis.best_branch_revenue || 0) > 0 ? `${adminMoney(kpis.best_branch_revenue)} · all branches` : 'No completed sales in this period';
}

function renderBranchSalesChart(rows) {
    const target = document.getElementById('branchSalesChart');
    if (!rows.length) {
        target.innerHTML = '<p class="empty">No branch sales are available for the selected period.</p>';
        return;
    }

    const branches = rows.map(row => ({
        name: String(row.name || ''),
        revenue: Number(row.revenue || 0)
    }));
    const maxValue = Math.max(...branches.map(branch => branch.revenue), 0);
    const minValue = Math.min(...branches.map(branch => branch.revenue));
    const rawStep = maxValue > 0 ? maxValue / 3 : 1;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalizedStep = rawStep / magnitude;
    const step = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * magnitude;
    const axisMax = step * 3;
    const width = 860;
    const height = 330;
    const left = 96;
    const right = 18;
    const top = 20;
    const bottom = 54;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const colors = ['#087f78', '#1aa7c1', '#d98a10', '#5572d8'];
    const gridLines = Array.from({ length: 4 }, (_, index) => {
        const value = axisMax - (step * index);
        const y = top + (chartHeight * index / 3);
        return `<g><line class="chart-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line><text class="chart-axis-label" x="${left - 10}" y="${y + 5}" text-anchor="end">${adminMoney(value)}</text></g>`;
    }).join('');
    const bars = branches.map((branch, index) => {
        const groupWidth = chartWidth / branches.length;
        const barWidth = Math.min(92, groupWidth * 0.58);
        const center = left + (groupWidth * (index + 0.5));
        const barHeight = chartHeight * branch.revenue / axisMax;
        const y = top + chartHeight - barHeight;
        return `<g>
            <rect x="${center - barWidth / 2}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5" fill="${colors[index % colors.length]}"><title>${escapeAdmin(branch.name)}: ${adminMoney(branch.revenue)}</title></rect>
            <text class="branch-sales-value" x="${center}" y="${Math.max(top + 12, y - 9)}" text-anchor="middle">${adminMoney(branch.revenue)}</text>
            <text class="chart-date-label" x="${center}" y="${height - 18}" text-anchor="middle">${escapeAdmin(branch.name)}</text>
        </g>`;
    }).join('');

    const highestBranches = branches.filter(branch => branch.revenue === maxValue).map(branch => branch.name);
    const lowestBranches = branches.filter(branch => branch.revenue === minValue).map(branch => branch.name);
    const summary = maxValue > 0 ?
        `Highest: ${highestBranches.map(escapeAdmin).join(', ')} · ${adminMoney(maxValue)}. Lowest: ${lowestBranches.map(escapeAdmin).join(', ')} · ${adminMoney(minValue)}.` :
        'No completed sales in the selected period.';

    target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="branchSalesSvgTitle branchSalesSvgDescription">
        <title id="branchSalesSvgTitle">Completed sales by branch</title>
        <desc id="branchSalesSvgDescription">${branches.map(branch => `${branch.name}: ${adminMoney(branch.revenue)}`).join('; ')}</desc>
        ${gridLines}${bars}
    </svg><p class="branch-sales-summary">${summary}</p>`;
}

function renderInventoryStockChart(products) {
    const target = document.getElementById('inventoryStockChart');
    if (!products.length) {
        target.innerHTML = '<p class="empty">No active products are available for inventory comparison.</p>';
        return;
    }

    const branches = Array.isArray(products[0].branches) ? products[0].branches : [];
    if (!branches.length) {
        target.innerHTML = '<p class="empty">Branch stock data is unavailable.</p>';
        return;
    }
    const maxStock = Math.max(...products.flatMap(product =>
        (Array.isArray(product.branches) ? product.branches : []).map(branch => Number(branch.stock_qty || 0))), 1);
    const rows = products.map(product => {
        const stocks = new Map((Array.isArray(product.branches) ? product.branches : [])
            .map(branch => [branch.name, Number(branch.stock_qty || 0)]));
        return `<tr>
            <th scope="row">${escapeAdmin(product.product_name)}</th>
            ${branches.map(branch => {
                const quantity = stocks.get(branch.name) || 0;
                const isLow = quantity <= overviewLowStockThreshold;
                const percent = Math.round((quantity / maxStock) * 100);
                return `<td>
                    <div class="stock-level${isLow ? ' is-low' : ''}">
                        <strong>${quantity.toLocaleString()} units</strong>
                        ${isLow ? '<span class="stock-warning">Low stock</span>' : ''}
                    </div>
                    <div class="stock-level-track" role="img" aria-label="${escapeAdmin(product.product_name)} at ${escapeAdmin(branch.name)}: ${quantity.toLocaleString()} units; warning threshold ${overviewLowStockThreshold}">
                        <i style="width:${percent}%"></i>
                    </div>
                </td>`;
            }).join('')}
        </tr>`;
    }).join('');

    target.innerHTML = `<div class="inventory-stock-scroll">
        <table class="inventory-stock-table">
            <thead><tr><th scope="col">Product</th>${branches.map(branch => `<th scope="col">${escapeAdmin(branch.name)}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

function renderDailyOrderTrend(rows, period, selectedDate) {
    const target = document.getElementById('dailyOrdersChart');
    const valuesByDate = new Map(rows.map(row => [String(row.sale_date), Number(row.order_count || 0)]));
    const [year, month, day] = selectedDate.split('-').map(Number);
    let buckets;
    if (period === 'year') {
        buckets = Array.from({ length: 12 }, (_, index) => {
            const date = new Date(year, index, 1);
            const keyPrefix = `${year}-${String(index + 1).padStart(2, '0')}-`;
            const value = Array.from(valuesByDate.entries())
                .filter(([key]) => key.startsWith(keyPrefix))
                .reduce((total, [, count]) => total + count, 0);
            return {
                key: keyPrefix,
                label: date.toLocaleDateString(undefined, { month: 'short' }),
                value
            };
        });
    } else {
        const count = period === 'month' ? new Date(year, month, 0).getDate() : 1;
        buckets = Array.from({ length: count }, (_, index) => {
            const date = period === 'month' ? new Date(year, month - 1, index + 1) : new Date(year, month - 1, day);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            return {
                key,
                label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                value: valuesByDate.get(key) || 0
            };
        });
    }

    const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0);
    const peak = buckets.reduce((highest, bucket) => bucket.value > highest.value ? bucket : highest, buckets[0]);
    const maxValue = Math.max(...buckets.map(bucket => bucket.value), 0);
    const rawStep = Math.max(1, maxValue / 4);
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalizedStep = rawStep / magnitude;
    const step = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * magnitude;
    const axisMax = step * 4;
    const width = 900;
    const height = 320;
    const left = 64;
    const right = 20;
    const top = 24;
    const bottom = 52;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const slotWidth = chartWidth / buckets.length;
    const barWidth = Math.max(2, Math.min(34, slotWidth * 0.64));
    const gridLines = Array.from({ length: 5 }, (_, index) => {
        const value = axisMax - (step * index);
        const y = top + (chartHeight * index / 4);
        return `<g><line class="chart-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line><text class="chart-axis-label" x="${left - 10}" y="${y + 4}" text-anchor="end">${Math.round(value).toLocaleString()}</text></g>`;
    }).join('');
    const bars = buckets.map((bucket, index) => {
        const x = left + slotWidth * index + (slotWidth - barWidth) / 2;
        const barHeight = chartHeight * bucket.value / axisMax;
        const y = top + chartHeight - barHeight;
        return `<g>
            <rect class="order-chart-bar" x="${x}" y="${y}" width="${barWidth}" height="${Math.max(1, barHeight)}" rx="3"><title>${escapeAdmin(bucket.label)}: ${bucket.value.toLocaleString()} orders and counter sales</title></rect>
            ${buckets.length <= 12 ? `<text class="order-chart-value" x="${x + barWidth / 2}" y="${Math.max(top + 12, y - 7)}" text-anchor="middle">${bucket.value.toLocaleString()}</text>` : ''}
        </g>`;
    }).join('');
    const labelInterval = period === 'year' ? 1 : Math.ceil(buckets.length / 8);
    const labels = buckets.map((bucket, index) => index % labelInterval === 0 || index === buckets.length - 1 ?
        `<text class="chart-date-label" x="${left + slotWidth * (index + 0.5)}" y="${height - 19}" text-anchor="middle">${escapeAdmin(bucket.label)}</text>` : '').join('');
    const summary = total === 0
        ? '<p class="daily-orders-empty">No orders or counter sales were recorded in this period.</p>'
        : `<div class="daily-orders-summary" aria-label="Order summary">
            <div><span>Total transactions</span><strong>${total.toLocaleString()}</strong></div>
            ${period === 'day' ? '' : `<div><span>Busiest ${period === 'year' ? 'month' : 'day'}</span><strong>${escapeAdmin(peak.label)} · ${peak.value.toLocaleString()}</strong></div>`}
        </div>`;
    const note = period === 'year' ? 'Monthly totals · orders and counter sales' :
        period === 'month' ? 'Daily totals · orders and counter sales' :
        `Orders and counter sales · ${new Date(year, month - 1, day).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`;
    document.getElementById('dailyOrdersTitle').textContent = period === 'year' ? 'Monthly Order Trends' : 'Daily Order Trends';
    document.getElementById('dailyOrdersPeriodNote').textContent = note;

    target.innerHTML = `${summary}
        <div class="daily-orders-legend"><i aria-hidden="true"></i><span>Orders and counter sales</span></div>
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="dailyOrdersSvgTitle dailyOrdersSvgDescription">
            <title id="dailyOrdersSvgTitle">Orders and counter sales ${period === 'year' ? 'by month' : 'by day'}</title>
            <desc id="dailyOrdersSvgDescription">${buckets.map(bucket => `${bucket.label}: ${bucket.value.toLocaleString()} transactions`).join('; ')}</desc>
            ${gridLines}
            <text class="chart-axis-title" transform="translate(17 ${top + chartHeight / 2}) rotate(-90)" text-anchor="middle">Transactions</text>
            ${bars}
            ${labels}
            <text class="chart-axis-title" x="${left + chartWidth / 2}" y="${height - 2}" text-anchor="middle">${period === 'year' ? 'Month' : 'Date'}</text>
        </svg>`;
}

function renderDecisionSupport(data) {
    const target = document.getElementById('dssInsights');
    const products = data.forecast_products || [];
    const recommendations = [];
    const hasForecastHistory = products.some(product => Number(product.historical_units || 0) > 0);
    const restockProducts = products
        .filter(product => Number(product.restock_units || 0) > 0)
        .sort((first, second) => Number(second.restock_units) - Number(first.restock_units));
    const lowStockProducts = products.filter(product => Number(product.stock_qty || 0) <= overviewLowStockThreshold);
    const risingDemandProducts = products
        .filter(product => {
            const recent = Number(product.recent_units || 0);
            const previous = Number(product.previous_units || 0);
            return recent > 0 && (previous === 0 || recent >= previous * 1.2);
        })
        .sort((first, second) => Number(second.recent_units || 0) - Number(first.recent_units || 0));

    if (products.length && !hasForecastHistory) {
        recommendations.push('<li><strong>Forecast limits:</strong> No product sales were recorded in the 28-day forecast period, so demand estimates may not be reliable. Review sales history before using the forecast for stock planning.</li>');
    }

    restockProducts.slice(0, 3).forEach(product => {
        recommendations.push(`<li><strong>Inventory planning:</strong> ${escapeAdmin(product.product_name)} has ${Number(product.stock_qty || 0)} units recorded, compared with an estimated ${Number(product.forecast_units || 0)} units of demand over the next 7 days. Review whether restocking is needed.</li>`);
    });

    if (lowStockProducts.length) {
        lowStockProducts
            .filter(product => !restockProducts.includes(product))
            .slice(0, 3)
            .forEach(product => {
                recommendations.push(`<li><strong>Low stock:</strong> ${escapeAdmin(product.product_name)} has ${Number(product.stock_qty || 0)} units recorded. Check the branch's inventory before planning new orders.</li>`);
            });
    }

    risingDemandProducts.slice(0, 3).forEach(product => {
        const recent = Number(product.recent_units || 0);
        const previous = Number(product.previous_units || 0);
        const trend = previous === 0 ?
            `Recent sales recorded ${recent} units; none were recorded in the preceding 7 days` :
            `Recent 7-day sales increased ${Math.round(((recent - previous) / previous) * 100)}% versus the preceding 7 days`;
        recommendations.push(`<li><strong>Demand signal:</strong> ${escapeAdmin(product.product_name)} — ${trend}. Review alongside the forecast.</li>`);
    });

    const openDeliveries = Number(data.open_deliveries || 0);
    const fulfillment = Number(data.fulfillment_rate || 0);
    const fulfillmentSummary = Number(data.recent_sales_count || 0) > 0 ?
        `recent fulfillment rate is ${fulfillment}%` :
        'there are no sales records in the last 30 days, so the fulfillment rate is unavailable';
    recommendations.push(`<li><strong>Delivery workload:</strong> ${openDeliveries} open deliveries; ${fulfillmentSummary}. Review the delivery queue if workload is building up.</li>`);

    target.innerHTML = recommendations.length ?
        `<ul>${recommendations.join('')}</ul>` :
        '<p class="empty">No inventory or demand signals need attention right now. Review the forecast and branch scorecard as part of routine planning.</p>';
}

async function loadOverviewBranchInsight(selectedBranch) {
    const target = document.getElementById('dssBranchInsight');
    if (selectedBranch !== 'all') {
        target.textContent = 'Branch comparison is based on all branches; select “All branches” in the Overview filter to see the current top and bottom revenue signals.';
        return;
    }

    try {
        const response = await rsmApi('admin_branch_comparison.php', {
            cache: 'no-store'
        });
        const data = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!data.success) throw new Error(data.message || 'Could not load branch comparison.');
        const branches = (data.branches || []).slice().sort((first, second) => Number(second.revenue || 0) - Number(first.revenue || 0));
        if (!branches.length) {
            target.textContent = 'Branch performance comparison is not available yet.';
            return;
        }
        target.textContent = `Branch performance: ${branches[0].name} currently leads monthly revenue at ${adminMoney(branches[0].revenue)}. ${branches.length > 1 ? `${branches[branches.length - 1].name} is currently lowest at ${adminMoney(branches[branches.length - 1].revenue)}.` : ''} Use the scorecard to review other performance measures.`;
    } catch (error) {
        target.textContent = error.message || 'Branch comparison insight is unavailable.';
    }
}

function renderRevenueChart(rows, period, selectedDate) {
    const target = document.getElementById('revenueChart');
    const valuesByDate = new Map(rows.map(row => [String(row.sale_date), Number(row.revenue || 0)]));
    const [year, month, day] = selectedDate.split('-').map(Number);
    const count = period === 'day' ? 1 : period === 'month' ? new Date(year, month, 0).getDate() : 12;
    const buckets = Array.from({ length: count }, (_, index) => {
        const date = period === 'year' ? new Date(year, index, 1) :
            period === 'month' ? new Date(year, month - 1, index + 1) :
            new Date(year, month - 1, day);
        const key = period === 'year' ?
            `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01` :
            `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        return {
            key,
            label: date.toLocaleDateString(undefined, period === 'year' ?
                { month: 'short' } : { month: 'short', day: 'numeric' }),
            value: valuesByDate.get(key) || 0
        };
    });

    const maxValue = Math.max(...buckets.map(bucket => bucket.value));
    const rawStep = maxValue > 0 ? maxValue / 3 : 1;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalizedStep = rawStep / magnitude;
    const step = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * magnitude;
    const axisMax = step * 3;
    const width = 800;
    const height = 310;
    const left = 74;
    const right = 18;
    const top = 18;
    const bottom = 42;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const points = buckets.map((bucket, index) => ({
        x: left + (buckets.length === 1 ? chartWidth / 2 : chartWidth * index / (buckets.length - 1)),
        y: top + chartHeight * (1 - bucket.value / axisMax),
    }));
    const gridLines = Array.from({
        length: 4
    }, (_, index) => {
        const value = axisMax - (step * index);
        const y = top + (chartHeight * index / 3);
        return `<g><line class="chart-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line><text class="chart-axis-label" x="${left - 10}" y="${y + 5}" text-anchor="end">${Math.round(value).toLocaleString()}</text></g>`;
    }).join('');
    const linePoints = points.map(point => `${point.x},${point.y}`).join(' ');
    const pointMarks = points.map((point, index) => `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="5.5"><title>${buckets[index].label}: ${adminMoney(buckets[index].value)}</title></circle>`).join('');
    const labelInterval = period === 'year' ? 1 : Math.ceil(buckets.length / 8);
    const dateLabels = points.map((point, index) => index % labelInterval === 0 || index === points.length - 1 ?
        `<text class="chart-date-label" x="${point.x}" y="${height - 9}" text-anchor="middle">${escapeAdmin(buckets[index].label)}</text>` : '').join('');
    const periodLabel = period === 'day' ? 'selected day' : period === 'month' ? 'selected month' : 'selected year';

    target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="revenueSvgTitle revenueSvgDescription">
        <title id="revenueSvgTitle">Revenue for the ${periodLabel}</title>
        <desc id="revenueSvgDescription">${buckets.map(bucket => `${bucket.label}: ${adminMoney(bucket.value)}`).join('; ')}</desc>
        ${gridLines}
        <polyline class="revenue-line" points="${linePoints}"></polyline>
        ${pointMarks}
        ${dateLabels}
    </svg>`;
}

function renderOrderStatusChart(rows, period) {
    const target = document.getElementById('orderStatusChart');
    const statusOrder = [
        ['pending', 'Pending', '#078778'],
        ['confirmed', 'Confirmed', '#23a996'],
        ['preparing', 'Preparing', '#f2a532'],
        ['out_for_delivery', 'Out for delivery', '#168fc2'],
        ['completed', 'Delivered', '#5572d8'],
        ['cancelled', 'Cancelled', '#c0392b'],
    ];
    const counts = new Map(rows.map(row => [row.order_status, Number(row.order_count || 0)]));
    const statuses = statusOrder.map(([key, label, color]) => ({
        label,
        color,
        count: counts.get(key) || 0
    }));
    const total = statuses.reduce((sum, status) => sum + status.count, 0);
    let progress = 0;
    const segments = statuses.filter(status => status.count > 0).map(status => {
        const start = progress;
        progress += (status.count / total) * 100;
        return `${status.color} ${start}% ${progress}%`;
    });
    const background = total ? `conic-gradient(${segments.join(', ')})` : '#edf1ee';

    const periodLabel = period === 'day' ? 'selected day' : period === 'month' ? 'selected month' : 'selected year';
    target.innerHTML = `<div class="status-donut" role="img" aria-label="${total} orders for the ${periodLabel} by status" style="--status-donut:${background}">
            <div><strong>${total.toLocaleString()}</strong><span>orders</span></div>
        </div>
        <ul class="status-legend">${statuses.map(status => `<li><span class="status-key"><i style="--status-color:${status.color}"></i>${status.label}</span><strong>${status.count.toLocaleString()}</strong></li>`).join('')}</ul>`;
}

function renderTopProducts(products, period) {
    const target = document.getElementById('topProductsChart');
    if (!products.length) {
        target.innerHTML = '<p class="empty">No product sales in the selected period.</p>';
        return;
    }

    const maxUnits = Math.max(...products.map(product => Number(product.units_sold || 0)), 1);
    target.innerHTML = products.map(product => {
        const units = Number(product.units_sold || 0);
        const percent = Math.round((units / maxUnits) * 100);
        return `<div class="top-product-row">
            <div class="top-product-label"><span>${escapeAdmin(product.product_name)}</span><strong>${units.toLocaleString()}</strong></div>
            <div class="top-product-track" role="img" aria-label="${escapeAdmin(product.product_name)}: ${units.toLocaleString()} units sold">
                <i style="width:${percent}%"></i>
            </div>
        </div>`;
    }).join('');
}

async function setupForecastDashboard(initialBranch) {
    const branchFilter = document.getElementById('forecastBranchFilter');
    const historyFilter = document.getElementById('forecastHistoryFilter');
    const horizonFilter = document.getElementById('forecastHorizonFilter');
    const productFilter = document.getElementById('forecastProductFilter');
    const status = document.getElementById('forecastLoadStatus');
    const message = document.getElementById('pageMessage');
    let responseData = null;
    let requestId = 0;

    if (!window.rsmSalesForecast) throw new Error('The forecasting model could not be loaded.');
    branchFilter.value = initialBranch;

    const render = () => {
        if (!responseData) return;
        const horizon = Number(horizonFilter.value);
        const days = Number(historyFilter.value);
        const dashboard = window.rsmSalesForecast.createDashboardForecast(responseData, days, horizon);
        updateForecastProductFilter(dashboard.products, productFilter);
        renderForecastDashboard(dashboard, {
            branch: branchFilter.value,
            horizon,
            days,
            productId: productFilter.value,
            generatedAt: new Date(),
        });
    };

    const fetchData = async () => {
        const thisRequest = ++requestId;
        const days = Number(historyFilter.value);
        const branch = branchFilter.value;
        responseData = null;
        status.textContent = 'Loading verified sales history…';
        status.classList.add('is-loading');
        message.textContent = '';
        setForecastDashboardLoading();
        try {
            const query = new URLSearchParams({ branch, days: String(days) });
            const response = await rsmApi(`admin_forecast_data.php?${query.toString()}`);
            const data = await response.json();
            if (response.status === 401) {
                window.location.href = 'Admin_login.html';
                return;
            }
            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Forecast sales data is unavailable.');
            }
            if (thisRequest !== requestId) return;
            responseData = data;
            render();
            status.textContent = `${data.history_days} days of actual sales · Data through ${data.as_of}`;
            status.classList.remove('is-loading');
        } catch (error) {
            if (thisRequest !== requestId) return;
            status.textContent = 'Forecast data unavailable';
            status.classList.remove('is-loading');
            message.textContent = `${error.message || 'Could not load forecast data.'} To enable this dashboard, review and run supabase/forecast_dashboard_analytics.sql in the Supabase SQL Editor.`;
            ['forecastRevenue', 'forecastOrders', 'forecastMae', 'forecastTopProduct', 'forecastShortage', 'forecastRestock']
                .forEach(id => { document.getElementById(id).textContent = 'Unavailable'; });
            ['forecastRevenueNote', 'forecastUnitsNote', 'forecastMaeNote', 'forecastTopProductNote',
                'forecastShortageNote', 'forecastRestockNote']
                .forEach(id => { document.getElementById(id).textContent = 'Forecast data unavailable.'; });
            document.getElementById('forecastModelSummary').textContent = 'Actual sales could not be loaded; no forecasts or recommendations are displayed.';
            document.getElementById('forecastInventoryNote').textContent = 'Recommendations are unavailable because current sales and inventory data could not be loaded.';
            document.getElementById('forecastTrendChart').innerHTML = '<p class="empty">Forecast data is unavailable. No sample or generated sales are shown.</p>';
            document.getElementById('forecastModelTable').innerHTML = '<p class="empty">Model comparison is unavailable.</p>';
            document.getElementById('forecastProductBars').innerHTML = '<p class="empty">Forecast data is unavailable.</p>';
            document.getElementById('forecastBranchChart').innerHTML = '<p class="empty">Forecast data is unavailable.</p>';
            document.getElementById('forecastDailyTable').innerHTML = '<p class="empty">Forecast data is unavailable.</p>';
            document.getElementById('forecastInventoryTable').innerHTML = '<p class="empty">Forecast data is unavailable.</p>';
            document.getElementById('forecastInsights').innerHTML = '<p class="empty">Insights are unavailable until actual sales data can be loaded.</p>';
        }
    };

    branchFilter.addEventListener('change', fetchData);
    historyFilter.addEventListener('change', fetchData);
    horizonFilter.addEventListener('change', render);
    productFilter.addEventListener('change', render);
    await fetchData();
}

function setForecastDashboardLoading() {
    ['forecastRevenue', 'forecastOrders', 'forecastMae', 'forecastTopProduct', 'forecastShortage', 'forecastRestock']
        .forEach(id => { document.getElementById(id).textContent = 'Loading…'; });
    document.getElementById('forecastModelSummary').textContent = 'Refreshing actual sales history and validating candidate models…';
    document.getElementById('forecastTrendChart').innerHTML = '<p class="empty">Loading actual sales and forecast…</p>';
    document.getElementById('forecastModelTable').innerHTML = '<p class="empty">Validating models…</p>';
    document.getElementById('forecastProductBars').innerHTML = '<p class="empty">Loading forecast…</p>';
    document.getElementById('forecastBranchChart').innerHTML = '<p class="empty">Loading branch forecasts…</p>';
    document.getElementById('forecastDailyTable').innerHTML = '<p class="empty">Loading daily demand…</p>';
    document.getElementById('forecastInventoryTable').innerHTML = '<p class="empty">Loading inventory…</p>';
    document.getElementById('forecastInsights').innerHTML = '<p class="empty">Calculating supported insights…</p>';
}

function updateForecastProductFilter(products, filter) {
    const previous = filter.value;
    filter.innerHTML = '<option value="all">All products</option>' +
        products.map(product => `<option value="${Number(product.product_id)}">${escapeAdmin(product.product_name)}</option>`).join('');
    filter.value = products.some(product => String(product.product_id) === previous) ? previous : 'all';
}

function forecastNumber(value, digits = 1) {
    return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function forecastHorizonTotal(result, horizon) {
    return result.forecast.slice(0, horizon).reduce((total, value) => total + value, 0);
}

function renderForecastDashboard(dashboard, filters) {
    const branch = filters.branch;
    const horizon = filters.horizon;
    const selected = filters.productId === 'all' ? dashboard.products :
        dashboard.products.filter(product => String(product.product_id) === filters.productId);
    const eligible = selected.filter(product => product.branchForecasts[branch].result.sufficient);
    const generated = filters.generatedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const forecastProducts = eligible.map(product => {
        const branchData = product.branchForecasts[branch];
        const result = branchData.result;
        return {
            product,
            branchData,
            result,
            demand: forecastHorizonTotal(result, horizon),
            demand7: forecastHorizonTotal(result, 7),
            revenue: forecastHorizonTotal(result, horizon) * Number(product.price || 0),
        };
    });

    document.getElementById('reportDate').textContent = `Last generated ${generated}`;
    document.getElementById('forecastRevenueNote').textContent =
        `Selected period at current listed prices · ${forecastProducts.length}/${selected.length} products forecastable`;
    document.getElementById('forecastUnitsNote').textContent =
        `Expected demand for the next ${horizon} days · ${branch === 'all' ? 'all branches combined' : branch}`;
    document.getElementById('forecastInventoryNote').textContent =
        'Restock estimates compare 7-day demand with branch stock. Supplier lead time and safety stock are not tracked; suggestions do not change inventory or create orders.';
    document.getElementById('forecastRevenue').textContent = forecastProducts.length ?
        adminMoney(forecastProducts.reduce((total, item) => total + item.revenue, 0)) : 'Insufficient Data';
    document.getElementById('forecastOrders').textContent = forecastProducts.length ?
        forecastNumber(forecastProducts.reduce((total, item) => total + item.demand, 0)) : 'Insufficient Data';

    const accuracyRows = forecastProducts.filter(item => item.result.metrics.observations > 0);
    const observationCount = accuracyRows.reduce((total, item) => total + item.result.metrics.observations, 0);
    if (observationCount) {
        const mae = accuracyRows.reduce((total, item) => total +
            item.result.metrics.mae * item.result.metrics.observations, 0) / observationCount;
        const rmse = Math.sqrt(accuracyRows.reduce((total, item) => total +
            item.result.metrics.rmse ** 2 * item.result.metrics.observations, 0) / observationCount);
        const mapeCount = accuracyRows.reduce((total, item) => total + item.result.metrics.mapeObservations, 0);
        const mape = mapeCount ? accuracyRows.reduce((total, item) => total +
            (item.result.metrics.mape || 0) * item.result.metrics.mapeObservations, 0) / mapeCount : null;
        document.getElementById('forecastMae').textContent = `${forecastNumber(mae, 2)} units`;
        document.getElementById('forecastMaeNote').textContent =
            `Untouched 7-day holdout · RMSE ${forecastNumber(rmse, 2)} · ${mape === null ? 'MAPE unavailable' : `MAPE ${forecastNumber(mape, 1)}% on nonzero days`}`;
    } else {
        document.getElementById('forecastMae').textContent = 'Insufficient Data';
        document.getElementById('forecastMaeNote').textContent = 'Not enough held-out sales days to validate a model.';
    }

    const topProduct = forecastProducts.slice().sort((first, second) => second.demand - first.demand)[0];
    document.getElementById('forecastTopProduct').textContent = topProduct ?
        topProduct.product.product_name : 'Insufficient Data';
    document.getElementById('forecastTopProductNote').textContent = topProduct ?
        `${forecastNumber(topProduct.demand)} units in ${horizon} days · highest among forecastable products` :
        'No reliable product forecast is available.';

    const shortageRows = forecastProducts.filter(item => item.branchData.stock < item.demand7);
    const restockTotal = shortageRows.reduce((total, item) =>
        total + Math.max(0, Math.ceil(item.demand7 - item.branchData.stock)), 0);
    document.getElementById('forecastShortage').textContent = forecastProducts.length ?
        `${shortageRows.length} product${shortageRows.length === 1 ? '' : 's'}` : 'Insufficient Data';
    document.getElementById('forecastShortageNote').textContent =
        `${forecastProducts.length} products have a reliable 7-day estimate; shortage compares that demand with current stock.`;
    document.getElementById('forecastRestock').textContent = forecastProducts.length ?
        `${restockTotal.toLocaleString()} units` : 'Insufficient Data';
    document.getElementById('forecastRestockNote').textContent =
        'Estimated 7-day shortfall only; confirm actual stock before approving.';

    const methodSummary = forecastProducts.length ?
        summarizeForecastMethods(forecastProducts) : 'Insufficient Data';
    document.getElementById('forecastModelSummary').textContent =
        `${methodSummary} · ${filters.days} days of history (${dashboard.dates[0]} through ${dashboard.asOf}) · actual sales are solid; forecasts are dashed.`;

    renderForecastTrendChart(dashboard, forecastProducts, filters);
    renderForecastModelComparison(forecastProducts);
    renderForecastProductBars(selected, branch, horizon);
    renderForecastBranchChart(selected, horizon);
    renderForecastDailyTable(forecastProducts, horizon, dashboard.asOf);
    renderForecastInventoryTable(selected, branch);
    renderForecastInsights(dashboard, forecastProducts, selected, horizon);
}

function summarizeForecastMethods(items) {
    const counts = new Map();
    items.forEach(item => {
        const method = item.result.method;
        counts.set(method, (counts.get(method) || 0) + 1);
    });
    return Array.from(counts.entries())
        .sort((first, second) => second[1] - first[1])
        .map(([method, count]) => `${method} (${count})`)
        .join(' · ');
}

function renderForecastTrendChart(dashboard, items, filters) {
    const target = document.getElementById('forecastTrendChart');
    if (!items.length) {
        target.innerHTML = '<p class="empty">Insufficient Data: at least 21 days of history and 3 days with recorded sales are required for a validated forecast.</p>';
        return;
    }

    const history = dashboard.dates.map((_, index) =>
        items.reduce((total, item) => total + item.branchData.history[index], 0));
    const forecast = Array.from({ length: filters.horizon }, (_, index) =>
        items.reduce((total, item) => total + item.result.forecast[index], 0));
    const showRange = items.every(item => item.result.interval);
    const lower = showRange ? forecast.map((value, index) => Math.max(0, value +
        items.reduce((total, item) => total + item.result.interval.lowerError, 0))) : [];
    const upper = showRange ? forecast.map((value, index) => Math.max(lower[index], value +
        items.reduce((total, item) => total + item.result.interval.upperError, 0))) : [];
    const historyTotal = history.reduce((total, value) => total + value, 0);
    const forecastTotal = forecast.reduce((total, value) => total + value, 0);
    const maximum = Math.max(...history, ...forecast, ...upper, 1);
    const rawStep = Math.max(1, maximum / 4);
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalizedStep = rawStep / magnitude;
    const step = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * magnitude;
    const axisMaximum = step * 4;
    const width = 900;
    const height = 340;
    const left = 64;
    const right = 18;
    const top = 22;
    const bottom = 62;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const count = history.length + forecast.length;
    const x = index => left + chartWidth * index / Math.max(count - 1, 1);
    const y = value => top + chartHeight - chartHeight * value / axisMaximum;
    const historyPath = history.map((value, index) =>
        `${index ? 'L' : 'M'} ${x(index)} ${y(value)}`).join(' ');
    const forecastPath = [history[history.length - 1], ...forecast].map((value, index) => {
        const pointIndex = history.length - 1 + index;
        return `${index ? 'L' : 'M'} ${x(pointIndex)} ${y(value)}`;
    }).join(' ');
    let range = '';
    if (showRange) {
        const upperPoints = upper.map((value, index) => `${x(history.length + index)} ${y(value)}`);
        const lowerPoints = lower.map((value, index) => `${x(history.length + index)} ${y(value)}`).reverse();
        const points = [`${x(history.length - 1)} ${y(history[history.length - 1])}`, ...upperPoints, ...lowerPoints].join(' ');
        range = `<polygon class="forecast-uncertainty" points="${points}"></polygon>`;
    }
    const forecastBoundary = (x(history.length - 1) + x(history.length)) / 2;
    const forecastRegion = `<rect class="forecast-region" x="${forecastBoundary}" y="${top}" width="${width - right - forecastBoundary}" height="${chartHeight}"></rect>`;
    const grid = Array.from({ length: 5 }, (_, index) => {
        const value = axisMaximum * (4 - index) / 4;
        const lineY = top + chartHeight * index / 4;
        return `<g><line class="forecast-grid-line" x1="${left}" y1="${lineY}" x2="${width - right}" y2="${lineY}"></line><text class="forecast-axis-label" x="${left - 8}" y="${lineY + 4}" text-anchor="end">${forecastNumber(value, 0)}</text></g>`;
    }).join('');
    const dateAtPoint = pointIndex => {
        if (pointIndex < dashboard.dates.length) {
            const date = dashboard.dates[pointIndex];
            return typeof date === 'string' ? date : date.toISOString().slice(0, 10);
        }
        const date = new Date(`${dashboard.asOf}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + pointIndex - dashboard.dates.length + 1);
        return date.toISOString().slice(0, 10);
    };
    const actualPoints = history.map((value, index) =>
        `<circle class="forecast-point forecast-actual-point" cx="${x(index)}" cy="${y(value)}" r="2.5"><title>${dateAtPoint(index)} · Actual sales: ${forecastNumber(value, 1)} units</title></circle>`).join('');
    const predictedPoints = forecast.map((value, index) => {
        const pointIndex = history.length + index;
        return `<circle class="forecast-point forecast-predicted-point" cx="${x(pointIndex)}" cy="${y(value)}" r="3"><title>${dateAtPoint(pointIndex)} · Predicted demand: ${forecastNumber(value, 1)} units</title></circle>`;
    }).join('');
    const labels = Array.from({ length: 6 }, (_, index) => {
        const pointIndex = Math.round((count - 1) * index / 5);
        return `<text class="forecast-axis-label" x="${x(pointIndex)}" y="${height - 25}" text-anchor="middle">${dateAtPoint(pointIndex).slice(5)}</text>`;
    }).join('');
    const title = filters.productId === 'all' ? 'Combined product demand' :
        items[0].product.product_name;
    target.innerHTML = `<div class="forecast-chart-summary">
        <div><span>Actual units · ${filters.days} days</span><strong>${forecastNumber(historyTotal, 0)}</strong></div>
        <div><span>Forecast units · ${filters.horizon} days</span><strong>${forecastNumber(forecastTotal, 0)}</strong></div>
    </div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="forecastTrendSvgTitle forecastTrendSvgDescription">
        <title id="forecastTrendSvgTitle">${escapeAdmin(title)} historical sales and demand forecast</title>
        <desc id="forecastTrendSvgDescription">Actual daily sales for ${filters.days} days followed by predicted demand for ${filters.horizon} days.</desc>
        <text class="forecast-axis-label" x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})">Units sold</text>
        ${forecastRegion}${grid}${range}
        <line class="forecast-boundary" x1="${forecastBoundary}" y1="${top}" x2="${forecastBoundary}" y2="${top + chartHeight}"></line>
        <text class="forecast-region-label" x="${left + 8}" y="${top + 14}">Actual</text>
        <text class="forecast-region-label" x="${forecastBoundary + 8}" y="${top + 14}">Forecast</text>
        <path class="forecast-history-line" d="${historyPath}"></path>
        <path class="forecast-prediction-line" d="${forecastPath}"></path>
        ${actualPoints}${predictedPoints}
        ${labels}
        <text class="forecast-axis-label" x="${left + chartWidth / 2}" y="${height - 3}" text-anchor="middle">Date</text>
    </svg>
    <div class="forecast-legend"><span><i class="forecast-legend-actual"></i>Actual sales</span><span><i class="forecast-legend-predicted"></i>Predicted demand</span>${showRange ? '<span><i class="forecast-legend-range"></i>Estimated range</span>' : ''}</div>
    <p class="forecast-chart-note">${showRange ? 'The shaded area shows the range of errors seen during model checks. It is an estimate, not a guarantee.' : 'The estimated range is hidden because there is not enough past model-check data.'}</p>`;
}

function renderForecastModelComparison(items) {
    const target = document.getElementById('forecastModelTable');
    const methods = window.rsmSalesForecast ? [
        'Linear regression',
        'Moving average',
        'Weighted moving average',
        'Exponential smoothing',
    ] : [];
    const rows = methods.map(method => {
        const scores = items.map(item => item.result.candidates.find(candidate => candidate.method === method))
            .filter(Boolean);
        const observations = scores.reduce((total, score) => total + score.observations, 0);
        if (!observations) return null;
        const mae = scores.reduce((total, score) => total + score.mae * score.observations, 0) / observations;
        const rmse = Math.sqrt(scores.reduce((total, score) => total +
            score.rmse ** 2 * score.observations, 0) / observations);
        const mapeObservations = scores.reduce((total, score) => total + score.mapeObservations, 0);
        const mape = mapeObservations ? scores.reduce((total, score) => total +
            (score.mape || 0) * score.mapeObservations, 0) / mapeObservations : null;
        const selectedCount = items.filter(item => item.result.method === method).length;
        return { method, mae, rmse, mape, selectedCount, observations };
    }).filter(Boolean).sort((first, second) => first.mae - second.mae);
    if (!rows.length) {
        target.innerHTML = '<p class="empty">Insufficient Data for time-based model comparison.</p>';
        return;
    }
    target.innerHTML = `<div class="table-scroll"><table><thead><tr><th>Method</th><th>Rolling validation MAE ↓</th><th>RMSE</th><th>MAPE*</th><th>Selected for products</th></tr></thead><tbody>${rows.map(row =>
        `<tr><th scope="row">${escapeAdmin(row.method)}</th><td>${forecastNumber(row.mae, 2)} units</td><td>${forecastNumber(row.rmse, 2)} units</td><td>${row.mape === null ? 'N/A' : `${forecastNumber(row.mape, 1)}%`}</td><td>${row.selectedCount}</td></tr>`
    ).join('')}</tbody></table></div><p class="forecast-chart-note">Scores aggregate ${rows[0].observations} older held-out product-days across forecastable products; the latest 7 days are reserved for the displayed accuracy KPI. *MAPE excludes days with zero actual sales. A lower error is better.</p>`;
}

function renderForecastProductBars(products, branch, horizon) {
    const target = document.getElementById('forecastProductBars');
    const rows = products.map(product => ({
        product,
        result: product.branchForecasts[branch].result,
    })).filter(item => item.result.sufficient)
        .map(item => ({ ...item, demand: forecastHorizonTotal(item.result, horizon) }))
        .sort((first, second) => second.demand - first.demand);
    if (!rows.length) {
        target.innerHTML = '<p class="empty">Insufficient Data: no product has enough history for a validated forecast.</p>';
        return;
    }
    const maximum = Math.max(...rows.map(item => item.demand), 1);
    target.innerHTML = rows.map(item => `<div class="forecast-bar-row">
        <span>${escapeAdmin(item.product.product_name)}</span>
        <div class="forecast-bar"><i style="width:${Math.min(100, item.demand / maximum * 100)}%"></i></div>
        <strong>${forecastNumber(item.demand)} units</strong>
    </div>`).join('');
}

function renderForecastBranchChart(products, horizon) {
    const target = document.getElementById('forecastBranchChart');
    const branches = window.rsmSalesForecast.branches.map(branch => {
        const values = products.map(product => {
            const result = product.branchForecasts[branch].result;
            return result.sufficient ? forecastHorizonTotal(result, horizon) : null;
        }).filter(value => value !== null);
        return { branch, demand: values.reduce((total, value) => total + value, 0), coverage: values.length };
    });
    const maximum = Math.max(...branches.map(item => item.demand), 1);
    target.innerHTML = branches.map(item => `<div class="forecast-bar-row forecast-branch-row">
        <span>${escapeAdmin(item.branch)}</span>
        <div class="forecast-bar"><i style="width:${Math.min(100, item.demand / maximum * 100)}%"></i></div>
        <strong>${item.coverage ? `${forecastNumber(item.demand)} units` : 'Insufficient Data'}<small>${item.coverage}/${products.length} products</small></strong>
    </div>`).join('');
}

function renderForecastDailyTable(items, horizon, asOf) {
    const target = document.getElementById('forecastDailyTable');
    if (!items.length) {
        target.innerHTML = '<p class="empty">Insufficient Data for daily demand estimates.</p>';
        return;
    }
    const daily = Array.from({ length: horizon }, (_, index) => ({
        date: new Date(`${asOf}T00:00:00Z`),
        units: items.reduce((total, item) => total + item.result.forecast[index], 0),
    }));
    daily.forEach((item, index) => item.date.setUTCDate(item.date.getUTCDate() + index + 1));
    target.innerHTML = `<div class="table-scroll"><table><thead><tr><th>Date</th><th>Predicted units</th></tr></thead><tbody>${daily.map(item =>
        `<tr><td>${item.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</td><td>${forecastNumber(item.units)}</td></tr>`
    ).join('')}</tbody></table></div>`;
}

function forecastInventoryStatus(stock, demand, sufficient) {
    if (!sufficient) return 'Insufficient Data';
    if (demand > 0 && stock <= demand * 0.2) return 'Critical Stock';
    if (stock < demand) return 'Restock Recommended';
    if (stock <= 10 || stock < demand * 1.25) return 'Low Stock';
    return 'Sufficient Stock';
}

function renderForecastInventoryTable(products, branch) {
    const target = document.getElementById('forecastInventoryTable');
    if (!products.length) {
        target.innerHTML = '<p class="empty">No active products match this filter.</p>';
        return;
    }
    target.innerHTML = `<div class="table-scroll"><table class="forecast-inventory-table">
        <thead><tr><th>Product</th><th>Available stock</th><th>Predicted 7-day demand</th><th>Estimated remaining</th><th>Recommended restock</th><th>Status</th></tr></thead>
        <tbody>${products.map(product => {
            const data = product.branchForecasts[branch];
            const result = data.result;
            const demand = result.sufficient ? forecastHorizonTotal(result, 7) : null;
            const restock = result.sufficient ? Math.max(0, Math.ceil(demand - data.stock)) : null;
            const remaining = result.sufficient ? data.stock - demand : null;
            const inventoryStatus = forecastInventoryStatus(data.stock, demand || 0, result.sufficient);
            const statusClass = inventoryStatus.toLowerCase().replace(/ /g, '-');
            return `<tr>
                <th scope="row">${escapeAdmin(product.product_name)}</th>
                <td>${forecastNumber(data.stock, 0)}</td>
                <td>${result.sufficient ? forecastNumber(demand) : 'Insufficient Data'}</td>
                <td>${result.sufficient ? forecastNumber(remaining) : 'Insufficient Data'}</td>
                <td>${result.sufficient ? restock.toLocaleString() : 'Insufficient Data'}</td>
                <td><span class="forecast-stock-status ${statusClass}">${inventoryStatus}</span></td>
            </tr>`;
        }).join('')}</tbody></table></div>`;
}

function renderForecastInsights(dashboard, forecastProducts, selectedProducts, horizon) {
    const target = document.getElementById('forecastInsights');
    const insights = [];
    if (!forecastProducts.length) {
        target.innerHTML = '<p class="empty">Insufficient Data: insights need at least 21 days of history and 3 days with recorded sales.</p>';
        return;
    }
    const topProduct = forecastProducts.slice().sort((first, second) => second.demand - first.demand)[0];
    if (topProduct) {
        insights.push(`${escapeAdmin(topProduct.product.product_name)} is projected to have the highest demand (${forecastNumber(topProduct.demand)} units) over the next ${horizon} days.`);
    }

    const trends = forecastProducts.map(item => {
        const history = item.branchData.history;
        const recent = history.slice(-7).reduce((total, value) => total + value, 0);
        const previous = history.slice(-14, -7).reduce((total, value) => total + value, 0);
        return { ...item, recent, previous };
    }).filter(item => item.recent > 0 || item.previous > 0)
        .sort((first, second) => Math.abs(second.recent - second.previous) - Math.abs(first.recent - first.previous));
    const unusual = trends.find(item => item.previous > 0 &&
        (item.recent >= item.previous * 1.5 || item.recent <= item.previous * 0.5) &&
        Math.abs(item.recent - item.previous) >= 3);
    if (unusual) {
        const direction = unusual.recent > unusual.previous ? 'increased' : 'decreased';
        insights.push(`${escapeAdmin(unusual.product.product_name)} demand ${direction} by ${forecastNumber(Math.abs(unusual.recent - unusual.previous), 0)} units versus the preceding 7 days; review this unusual change.`);
    } else {
        const newDemand = trends.find(item => item.previous === 0 && item.recent >= 3);
        const rising = trends.find(item => item.previous > 0 && item.recent >= item.previous * 1.2);
        if (newDemand) {
            insights.push(`${escapeAdmin(newDemand.product.product_name)} had ${forecastNumber(newDemand.recent, 0)} units of demand in the latest week after none in the preceding week; review this change.`);
        } else if (rising) {
            insights.push(`${escapeAdmin(rising.product.product_name)} demand is increasing compared with the previous week (${forecastNumber(rising.recent)} vs ${forecastNumber(rising.previous)} units).`);
        }
    }

    const branchTotals = dashboard.branches.map(branch => {
        const available = selectedProducts.map(product => {
            const result = product.branchForecasts[branch].result;
            return result.sufficient ? forecastHorizonTotal(result, horizon) : null;
        }).filter(value => value !== null);
        return { branch, demand: available.reduce((total, value) => total + value, 0), coverage: available.length };
    }).filter(item => item.coverage === selectedProducts.length && item.coverage > 0);
    if (branchTotals.length > 1) {
        branchTotals.sort((first, second) => second.demand - first.demand);
        insights.push(`${escapeAdmin(branchTotals[0].branch)} has the highest projected demand among branches with complete product coverage (${forecastNumber(branchTotals[0].demand)} units).`);
    }

    const branchShortages = dashboard.branches.map(branch => {
        const products = selectedProducts.map(product => {
            const branchData = product.branchForecasts[branch];
            const result = branchData.result;
            if (!result.sufficient) return null;
            const demand = forecastHorizonTotal(result, 7);
            return { stock: branchData.stock, demand };
        });
        if (products.some(item => !item)) return null;
        const shortageProducts = products.filter(item => item.stock < item.demand);
        const restockUnits = shortageProducts.reduce((total, item) =>
            total + Math.ceil(item.demand - item.stock), 0);
        return { branch, shortageProducts: shortageProducts.length, restockUnits };
    }).filter(item => item && item.shortageProducts > 0)
        .sort((first, second) => second.restockUnits - first.restockUnits);
    if (branchShortages.length) {
        const branch = branchShortages[0];
        insights.push(`${escapeAdmin(branch.branch)} may need additional inventory for ${branch.shortageProducts} product${branch.shortageProducts === 1 ? '' : 's'}; the estimated 7-day shortfall is ${branch.restockUnits} units.`);
    }

    const shortageCount = forecastProducts.filter(item => item.branchData.stock < item.demand7).length;
    if (shortageCount) {
        insights.push(`${shortageCount} product${shortageCount === 1 ? '' : 's'} may need review against projected 7-day demand. Recommendations do not place orders or modify stock.`);
    } else {
        insights.push(`Current stock covers the 7-day forecast for the ${forecastProducts.length} product${forecastProducts.length === 1 ? '' : 's'} with reliable estimates.`);
    }

    const patternItem = trends.find(item => item.branchData.history.length >= 28);
    if (patternItem) {
        const weekdayTotals = Array(7).fill(0);
        const weekdayCounts = Array(7).fill(0);
        patternItem.branchData.history.forEach((units, index) => {
            const weekday = new Date(`${dashboard.dates[index]}T00:00:00Z`).getUTCDay();
            weekdayTotals[weekday] += units;
            weekdayCounts[weekday]++;
        });
        const weekdayAverages = weekdayTotals.map((total, index) => weekdayCounts[index] ? total / weekdayCounts[index] : 0);
        const strongest = weekdayAverages.indexOf(Math.max(...weekdayAverages));
        const average = weekdayAverages.reduce((total, value) => total + value, 0) / weekdayAverages.length;
        if (average > 0 && weekdayAverages[strongest] >= average * 1.25) {
            const dayName = new Date(Date.UTC(2024, 0, strongest)).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
            insights.push(`${escapeAdmin(patternItem.product.product_name)} has its strongest average sales on ${dayName}, based on the selected history.`);
        }
    }

    target.innerHTML = `<ul>${insights.map(insight => `<li>${insight}</li>`).join('')}</ul>`;
}

async function setupDeliveryQueue() {
    await loadDeliveryQueue();
}

async function loadDeliveryQueue() {
    const table = document.getElementById('deliveryTable');
    table.innerHTML = '<p class="empty">Loading delivery queue...</p>';
    try {
        const response = await rsmApi('admin_delivery_data.php');
        const data = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!data.success) throw new Error(data.message || 'Could not load deliveries.');
        renderDelivery(data.orders);
    } catch (error) {
        table.innerHTML = `<p class="empty">${escapeAdmin(error.message || 'Could not load deliveries.')}</p>`;
    }
}

function renderDelivery(orders) {
    const groupedOrders = new Map();
    orders.forEach(order => {
        if (!groupedOrders.has(order.order_day)) groupedOrders.set(order.order_day, []);
        groupedOrders.get(order.order_day).push(order);
    });

    const orderTable = dayOrders => `<div class="table-scroll"><table class="delivery-table"><thead><tr><th>Order</th><th>Customer</th><th>Address</th><th>Payment · Total · Time</th><th>Status / Action</th></tr></thead><tbody>${dayOrders.map(order => {
        const nextStep = deliveryNextSteps[order.order_status];
        return `<tr><td>#${String(order.order_id).padStart(6, '0')}</td><td>${escapeAdmin(order.username)}</td><td>${escapeAdmin(order.delivery_address)}</td><td class="delivery-order-details"><strong>${escapeAdmin(order.payment_method)}</strong><span>${adminMoney(order.total_amount)}</span><time>${escapeAdmin(order.order_time)}</time></td><td class="delivery-status-cell"><span class="status-badge status-${escapeAdmin(order.order_status)}">${escapeAdmin(adminStatuses[order.order_status] || order.order_status)}</span><div class="delivery-status-actions">${nextStep ? `<button type="button" class="status-next" data-order-id="${order.order_id}" data-next-status="${nextStep.status}">${nextStep.label}</button>` : ''}<button type="button" class="status-cancel" data-order-id="${order.order_id}">Cancel order</button></div></td></tr>`;
    }).join('')}</tbody></table></div>`;
    document.getElementById('deliveryTable').innerHTML = groupedOrders.size ? [...groupedOrders.entries()].map(([date, dayOrders]) => {
        const formattedDate = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const dailyTotal = dayOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
        return `<section class="delivery-day-group"><div class="delivery-day-heading"><h4>${escapeAdmin(formattedDate)}</h4><span aria-hidden="true">-</span><strong>${adminMoney(dailyTotal)}</strong></div>${orderTable(dayOrders)}</section>`;
    }).join('') : '<p class="empty">No active deliveries.</p>';
    document.querySelectorAll('[data-next-status]').forEach(button => button.addEventListener('click', () => {
        updateDeliveryStatus(button.dataset.orderId, button.dataset.nextStatus);
    }));
    document.querySelectorAll('.status-cancel').forEach(button => button.addEventListener('click', () => {
        const orderNumber = String(button.dataset.orderId).padStart(6, '0');
        if (window.confirm(`Cancel order #${orderNumber}?`)) updateDeliveryStatus(button.dataset.orderId, 'cancelled');
    }));
}

let salesExportData = null;
let salesExportBound = false;

async function loadSales() {
    const table = document.getElementById('salesTable');
    table.innerHTML = '<p class="empty">Loading sales...</p>';
    try {
        await setupSaleForm();
        const exportButton = document.getElementById('exportSales');
        if (!salesExportBound) {
            exportButton.addEventListener('click', downloadSalesCsv);
            salesExportBound = true;
        }
        const selection = setupAdminDateFilter('salesDateFilter', loadSalesData);
        if (!selection) throw new Error('The sales date filter is unavailable.');
        await loadSalesData(selection.period, selection.date);
    } catch (error) {
        table.innerHTML = `<p class="empty">${escapeAdmin(error.message || 'Could not load sales.')}</p>`;
    }
}

let salesFilterRequest = 0;

async function loadSalesData(period, date) {
    const table = document.getElementById('salesTable');
    const status = document.querySelector('#salesDateFilter [data-status]');
    const exportButton = document.getElementById('exportSales');
    const request = ++salesFilterRequest;
    salesExportData = null;
    exportButton.disabled = true;
    table.innerHTML = '<p class="empty">Loading sales...</p>';
    status.textContent = 'Loading sales...';
    try {
        const query = new URLSearchParams({ period, date });
        const response = await rsmApi(`admin_sales_filtered.php?${query}`);
        const data = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!data.success) throw new Error(data.message || 'Could not load sales.');
        if (request !== salesFilterRequest) return;
        const branchField = document.querySelector('#saleForm [name="branch"]');
        if (!branchField) throw new Error('The sales branch field is missing.');
        if (data.branch !== 'all') {
            branchField.value = data.branch;
            branchField.disabled = true;
        } else {
            branchField.disabled = false;
        }
        renderSales(data.orders);
        salesExportData = { orders: data.orders, period, date };
        exportButton.disabled = data.orders.length === 0;
        const periodLabel = period === 'day' ? 'selected day' : period === 'month' ? 'selected month' : 'selected year';
        status.textContent = `Showing sales for the ${periodLabel}.`;
    } catch (error) {
        if (request !== salesFilterRequest) return;
        table.innerHTML = `<p class="empty">${escapeAdmin(error.message || 'Could not load sales.')}</p>`;
        status.textContent = error.message || 'Could not load sales.';
    }
}

function downloadSalesCsv() {
    if (!salesExportData || !salesExportData.orders.length) return;

    const columns = [
        ['Order #', order => order.sale_number || `#${order.order_id || order.sale_id}`],
        ['Date', order => order.order_day],
        ['Time', order => order.order_time],
        ['Type', order => order.sale_type || 'Online'],
        ['Customer', order => order.customer_name || order.username],
        ['Products', order => (order.items || []).map(item => item.product_name).join('; ')],
        ['Quantity', order => (order.items || []).map(item => item.quantity).join('; ')],
        ['Branch', order => order.branch],
        ['Location', order => order.location],
        ['Payment', order => order.payment_method],
        ['Delivered By', order => order.delivered_by],
        ['Total', order => order.total_amount],
    ];
    const csvCell = value => {
        let text = value == null ? '' : String(value);
        if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = [
        columns.map(([heading]) => csvCell(heading)).join(','),
        ...salesExportData.orders.map(order => columns.map(([, getValue]) => csvCell(getValue(order))).join(',')),
    ];
    const csv = `\uFEFF${rows.join('\r\n')}`;
    const fileDate = salesExportData.date.replace(/[^0-9-]/g, '');
    const fileName = `sales-${salesExportData.period}-${fileDate}.csv`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

let saleProducts = [];
let saleFormBound = false;

async function setupSaleForm() {
    const response = await rsmApi('admin_products.php');
    const data = await response.json();
    if (response.status === 401) {
        window.location.href = 'Admin_login.html';
        return;
    }
    if (!data.success) throw new Error(data.message || 'Could not load products for the sale form.');
    saleProducts = data.products.filter(product => Number(product.is_active) === 1);
    if (!saleFormBound) {
        document.getElementById('saleForm').addEventListener('submit', saveSale);
        document.getElementById('addSaleItem').addEventListener('click', () => addSaleItem());
        const saleItems = document.getElementById('saleItems');
        saleItems.addEventListener('change', updateSaleTotal);
        saleItems.addEventListener('input', updateSaleTotal);
        saleItems.addEventListener('click', event => {
            if (!event.target.classList.contains('remove-sale-item')) return;
            const rows = document.querySelectorAll('.sale-item-row');
            if (rows.length === 1) {
                rows[0].querySelector('.sale-product').value = '';
                rows[0].querySelector('.sale-quantity').value = '1';
            } else {
                event.target.closest('.sale-item-row').remove();
            }
            updateSaleTotal();
        });
        saleFormBound = true;
    }
    drawSaleItems();
    updateSaleTotal();
}

function drawSaleItems() {
    const options = saleProducts.map(product =>
        `<option value="${Number(product.product_id)}" ${Number(product.stock_qty) < 1 ? 'disabled' : ''}>${escapeAdmin(product.product_name)} · ${adminMoney(product.price)} · ${Number(product.stock_qty)} in stock</option>`
    ).join('');
    document.getElementById('saleItems').innerHTML = `<div class="sale-item-row">
        <label>Product<select class="sale-product" required>
            <option value="">Select a product</option>${options}
        </select></label>
        <label>Quantity<input class="sale-quantity" type="number" min="1" step="1" value="1" required></label>
        <button class="text-button danger remove-sale-item" type="button" aria-label="Remove product">Remove</button>
    </div>`;
}

function addSaleItem() {
    const options = saleProducts.map(product =>
        `<option value="${Number(product.product_id)}" ${Number(product.stock_qty) < 1 ? 'disabled' : ''}>${escapeAdmin(product.product_name)} · ${adminMoney(product.price)} · ${Number(product.stock_qty)} in stock</option>`
    ).join('');
    const row = document.createElement('div');
    row.className = 'sale-item-row';
    row.innerHTML = `<label>Product<select class="sale-product" required>
        <option value="">Select a product</option>${options}
    </select></label>
    <label>Quantity<input class="sale-quantity" type="number" min="1" step="1" value="1" required></label>
    <button class="text-button danger remove-sale-item" type="button" aria-label="Remove product">Remove</button>`;
    document.getElementById('saleItems').appendChild(row);
}

function updateSaleTotal() {
    const total = [...document.querySelectorAll('.sale-item-row')].reduce((sum, row) => {
        const product = saleProducts.find(item => String(item.product_id) === row.querySelector('.sale-product').value);
        const quantity = Math.max(0, Number(row.querySelector('.sale-quantity').value) || 0);
        return sum + (product ? Number(product.price) * quantity : 0);
    }, 0);
    document.getElementById('saleTotal').textContent = adminMoney(total);
}

async function saveSale(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById('saleFormMessage');
    const submit = document.getElementById('saleSubmit');
    const items = [...document.querySelectorAll('.sale-item-row')].map(row => ({
        product_id: row.querySelector('.sale-product').value,
        quantity: row.querySelector('.sale-quantity').value,
    }));
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.branch = form.elements.branch.value;
    payload.items = items;
    submit.disabled = true;
    message.textContent = '';
    message.className = 'form-message';
    try {
        const response = await rsmApi('admin_sales_data.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!result.success) throw new Error(result.message || 'Could not save the sale.');
        form.reset();
        message.textContent = result.message;
        message.className = 'form-message success';
        await loadSales();
    } catch (error) {
        message.textContent = error.message || 'Could not save the sale.';
        message.className = 'form-message';
    } finally {
        submit.disabled = false;
    }
}

function renderSales(orders) {
    const groupedOrders = new Map();
    orders.forEach(order => {
        if (!groupedOrders.has(order.order_day)) groupedOrders.set(order.order_day, []);
        groupedOrders.get(order.order_day).push(order);
    });

    const dayGroups = [...groupedOrders.entries()].map(([date, dayOrders]) => {
        const formattedDate = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
        const dailyTotal = dayOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
        const rows = dayOrders.map(order => {
            const items = Array.isArray(order.items) ? order.items : [];
            const products = items.map(item => `<span>${escapeAdmin(item.product_name)}</span>`).join('');
            const quantities = items.map(item => `<span>${Number(item.quantity)}</span>`).join('');
            return `<tr>
                <td>${escapeAdmin(order.sale_number || `#${order.order_id}`)}</td>
                <td>${escapeAdmin(order.sale_type || 'Online')}</td>
                <td>${escapeAdmin(order.username)}</td>
                <td class="sales-items-cell">${products || '—'}</td>
                <td class="sales-items-cell sales-quantity-cell">${quantities || '—'}</td>
                <td>${escapeAdmin(order.location || '—')}</td>
                <td>${escapeAdmin(order.payment_method)}</td>
                <td>${escapeAdmin(order.delivered_by)}</td>
                <td class="sales-amount">${adminMoney(order.total_amount)}</td>
                <td><time>${escapeAdmin(order.order_time)}</time></td>
            </tr>`;
        }).join('');

        return `<section class="sales-day-group" aria-label="Sales for ${escapeAdmin(formattedDate)}">
            <div class="sales-day-heading"><h4>${escapeAdmin(formattedDate)}</h4><span aria-hidden="true">·</span><strong>Total: ${adminMoney(dailyTotal)}</strong></div>
            <div class="table-scroll">
                <table class="sales-table">
                    <colgroup>
                        <col class="sales-order-column">
                        <col class="sales-type-column">
                        <col class="sales-customer-column">
                        <col class="sales-product-column">
                        <col class="sales-quantity-column">
                        <col class="sales-location-column">
                        <col class="sales-payment-column">
                        <col class="sales-delivered-column">
                        <col class="sales-total-column">
                        <col class="sales-time-column">
                    </colgroup>
                    <thead><tr><th>Order #</th><th>Type</th><th>Customer</th><th>Product</th><th>Quantity</th><th>Location</th><th>Payment</th><th>Delivered By</th><th>Total</th><th>Time</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>`;
    }).join('');

    document.getElementById('salesTable').innerHTML = dayGroups || '<p class="empty">No sales found.</p>';
}

async function updateDeliveryStatus(orderId, status) {
    try {
        const response = await rsmApi('admin_update_order.php', {
            method: 'POST',
            body: new URLSearchParams({
                order_id: orderId,
                status
            }),
        });
        const result = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        showToast(result.message);
        await loadDeliveryQueue();
    } catch (error) {
        showToast(error.message || 'Could not update order status.');
    }
}

let performanceDateSelection = null;
let performanceAnalyticsRequest = 0;
let performanceRefreshBound = false;

function renderPerformance(data) {
    performanceDateSelection = setupAdminDateFilter('performanceDateFilter', (period, date) => {
        performanceDateSelection = { period, date };
        loadPerformanceAnalytics(period, date);
    });
    if (!performanceDateSelection) throw new Error('The performance date filter is unavailable.');
    loadPerformanceAnalytics(performanceDateSelection.period, performanceDateSelection.date);

    if (!performanceRefreshBound) {
        window.setInterval(() => {
            if (!document.hidden && performanceDateSelection) {
                loadPerformanceAnalytics(performanceDateSelection.period, performanceDateSelection.date);
            }
        }, 15000);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && performanceDateSelection) {
                loadPerformanceAnalytics(performanceDateSelection.period, performanceDateSelection.date);
            }
        });
        window.addEventListener('focus', () => {
            if (performanceDateSelection) loadPerformanceAnalytics(performanceDateSelection.period, performanceDateSelection.date);
        });
        performanceRefreshBound = true;
    }
}

async function loadPerformanceAnalytics(period, date) {
    const request = ++performanceAnalyticsRequest;
    const status = document.getElementById('branchComparisonStatus');
    const filterStatus = document.querySelector('#performanceDateFilter [data-status]');
    const query = new URLSearchParams({ period, date });
    status.textContent = 'Loading branch performance...';
    filterStatus.textContent = '';
    try {
        const response = await rsmApi(`admin_performance_analytics.php?${query}`, { cache: 'no-store' });
        const data = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!data.success) throw new Error(data.message || 'Could not load branch performance.');
        if (request !== performanceAnalyticsRequest) return;

        const monthly = data.monthly || {};
        const revenuePercent = Math.min(100, Math.round((Number(monthly.revenue || 0) / 100000) * 100));
        const fulfillment = Number(data.fulfillment_rate || 0);
        const periodLabel = period === 'day' ? 'selected day' : period === 'month' ? 'selected month' : 'selected year';
        document.getElementById('performanceRevenueLabel').textContent = `Revenue · ${periodLabel}`;
        document.getElementById('performanceOrdersLabel').textContent = `Orders · ${periodLabel}`;
        document.getElementById('revenue').textContent = adminMoney(monthly.revenue);
        document.getElementById('orders').textContent = Number(monthly.order_count || 0).toLocaleString();
        document.getElementById('deliveries').textContent = Number(data.open_deliveries || 0).toLocaleString();
        document.getElementById('revenueBar').style.width = `${revenuePercent}%`;
        document.getElementById('revenueGoal').textContent = `${revenuePercent}%`;
        document.getElementById('fulfillmentBar').style.width = `${fulfillment}%`;
        document.getElementById('fulfillmentRate').textContent = `${fulfillment}%`;
        document.getElementById('performanceInsight').innerHTML = `<strong>Decision cue:</strong> fulfillment for the ${periodLabel} is at ${fulfillment}%. Keep the delivery desk clear to protect the branch experience.`;
        document.getElementById('performanceComparisonPeriod').textContent = periodLabel;
        renderBranchComparison(data.branches || []);
        renderPerformanceCharts(data.branches || [], data.monthly_sales || [], date);
        status.textContent = `Updated at ${new Date().toLocaleTimeString()}. Refreshes every 15 seconds.`;
    } catch (error) {
        if (request !== performanceAnalyticsRequest) return;
        renderPerformanceCharts([], [], date);
        status.textContent = error.message || 'Could not load branch performance.';
        filterStatus.textContent = error.message || 'Could not load branch performance.';
    }
}

function renderBranchComparison(branchData) {
    const branches = branchData.map(data => {
            const revenue = Number(data.revenue || 0);
            const orders = Number(data.orders || 0);
            const fulfillment = Number(data.fulfillment || 0);
            return {
                name: data.name,
                revenue,
                orders,
                fulfillment,
                open: Number(data.open || 0),
                score: Math.round((revenue / 100000 * 40) + (fulfillment * 0.4) + (orders / 200 * 20)),
            };
        })
        .sort((first, second) => second.score - first.score);
    if (!branches.length) {
        document.getElementById('branchComparison').innerHTML = '<p class="empty">No branch data is available.</p>';
        return;
    }
    const highestRevenue = Math.max(...branches.map(branch => branch.revenue), 0);
    document.getElementById('branchComparison').innerHTML = `<div class="comparison-table"><div class="comparison-row comparison-heading"><span>Branch</span><span>Revenue</span><span>Orders</span><span>Fulfillment</span><span>Score</span></div>${branches.map((branch, index) => `<div class="comparison-row"><span class="branch-name"><b class="rank">${index + 1}</b>${escapeAdmin(branch.name)}</span><span>${adminMoney(branch.revenue)}<i class="mini-bar"><em style="width:${highestRevenue ? Math.round((branch.revenue / highestRevenue) * 100) : 0}%"></em></i></span><span>${branch.orders}</span><span>${branch.fulfillment}%</span><strong>${branch.score}</strong></div>`).join('')}</div><div class="comparison-summary"><span><b>Top branch</b> ${escapeAdmin(branches[0].name)}</span><span><b>Needs attention</b> ${escapeAdmin(branches[branches.length - 1].name)} · ${branches[branches.length - 1].open} open deliveries</span></div>`;
}

function renderPerformanceCharts(branchData, monthlySales, date) {
    const branches = branchData.map(branch => ({
        name: String(branch.name || ''),
        revenue: Number(branch.revenue || 0),
        orders: Number(branch.orders || 0)
    }));
    renderPerformanceBarChart('performanceSalesChart', branches, 'revenue', adminMoney, 'Sales by branch', 'Total sales (₱)');
    renderPerformanceBarChart('performanceOrdersChart', branches, 'orders', value => Number(value).toLocaleString(), 'Orders by branch', 'Number of orders');
    document.getElementById('performanceTrendYear').textContent = date.slice(0, 4);
    renderMonthlySalesChart(monthlySales, branches, date.slice(0, 4));
}

function renderPerformanceBarChart(targetId, branches, metric, formatValue, title, axisLabel) {
    const target = document.getElementById(targetId);
    if (!branches.length) {
        target.innerHTML = '<p class="empty">Branch data is unavailable for this period.</p>';
        return;
    }

    const values = branches.map(branch => branch[metric]);
    const maximum = Math.max(...values, 0);
    const rawStep = maximum > 0 ? maximum / 4 : 1;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalizedStep = rawStep / magnitude;
    const step = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * magnitude;
    const axisMaximum = step * 4;
    const width = 860;
    const height = 330;
    const left = 96;
    const right = 18;
    const top = 20;
    const bottom = 58;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const colors = ['#087f78', '#1aa7c1', '#d98a10', '#5572d8'];
    const grid = Array.from({ length: 5 }, (_, index) => {
        const value = axisMaximum - (step * index);
        const y = top + (chartHeight * index / 4);
        return `<g><line class="chart-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line><text class="chart-axis-label" x="${left - 10}" y="${y + 5}" text-anchor="end">${formatValue(value)}</text></g>`;
    }).join('');
    const bars = branches.map((branch, index) => {
        const groupWidth = chartWidth / branches.length;
        const barWidth = Math.min(92, groupWidth * 0.58);
        const center = left + (groupWidth * (index + 0.5));
        const barHeight = chartHeight * branch[metric] / axisMaximum;
        const y = top + chartHeight - barHeight;
        return `<g>
            <rect x="${center - barWidth / 2}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5" fill="${colors[index % colors.length]}"><title>${escapeAdmin(branch.name)}: ${formatValue(branch[metric])}</title></rect>
            <text class="branch-sales-value" x="${center}" y="${Math.max(top + 12, y - 9)}" text-anchor="middle">${formatValue(branch[metric])}</text>
            <text class="chart-date-label" x="${center}" y="${height - 18}" text-anchor="middle">${escapeAdmin(branch.name)}</text>
        </g>`;
    }).join('');

    target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${targetId}Title ${targetId}Description">
        <title id="${targetId}Title">${title}</title>
        <desc id="${targetId}Description">${branches.map(branch => `${escapeAdmin(branch.name)}: ${formatValue(branch[metric])}`).join('; ')}</desc>
        <text class="chart-axis-label" x="20" y="${height / 2}" text-anchor="middle" transform="rotate(-90 20 ${height / 2})">${axisLabel}</text>
        ${grid}${bars}
    </svg>`;
}

function renderMonthlySalesChart(monthlySales, branches, year) {
    const target = document.getElementById('performanceMonthlySalesChart');
    const branchNames = branches.map(branch => branch.name);
    if (!branchNames.length || !monthlySales.length) {
        target.innerHTML = `<p class="empty">Monthly sales data is unavailable for ${escapeAdmin(year)}.</p>`;
        return;
    }

    const series = branchNames.map((name, branchIndex) => ({
        name,
        color: ['#087f78', '#1aa7c1', '#d98a10', '#5572d8'][branchIndex % 4],
        values: Array(12).fill(0)
    }));
    const seriesByName = new Map(series.map(item => [item.name, item]));
    monthlySales.forEach(row => {
        const month = Number(row.month);
        const item = seriesByName.get(String(row.branch || ''));
        if (item && Number.isInteger(month) && month >= 1 && month <= 12) {
            item.values[month - 1] = Number(row.revenue || 0);
        }
    });

    const maximum = Math.max(...series.flatMap(item => item.values), 0);
    const rawStep = maximum > 0 ? maximum / 4 : 1;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalizedStep = rawStep / magnitude;
    const step = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * magnitude;
    const axisMaximum = step * 4;
    const width = 900;
    const height = 360;
    const left = 96;
    const right = 20;
    const top = 24;
    const bottom = 48;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const grid = Array.from({ length: 5 }, (_, index) => {
        const value = axisMaximum - (step * index);
        const y = top + (chartHeight * index / 4);
        return `<g><line class="chart-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line><text class="chart-axis-label" x="${left - 10}" y="${y + 5}" text-anchor="end">${adminMoney(value)}</text></g>`;
    }).join('');
    const lines = series.map(item => {
        const points = item.values.map((value, index) => ({
            x: left + (chartWidth * index / 11),
            y: top + chartHeight - (chartHeight * value / axisMaximum),
            value,
            month: months[index]
        }));
        const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
        return `<g>
            <path class="performance-trend-line" d="${path}" stroke="${item.color}"></path>
            ${points.map(point => `<circle class="performance-trend-point" cx="${point.x}" cy="${point.y}" r="3.5" stroke="${item.color}"><title>${escapeAdmin(point.month)} · ${escapeAdmin(item.name)}: ${adminMoney(point.value)}</title></circle>`).join('')}
        </g>`;
    }).join('');
    const monthLabels = months.map((month, index) => {
        const x = left + (chartWidth * index / 11);
        return `<text class="chart-date-label" x="${x}" y="${height - 14}" text-anchor="middle">${month}</text>`;
    }).join('');
    const legend = series.map(item => `<span><i style="background:${item.color}"></i>${escapeAdmin(item.name)}</span>`).join('');
    const description = series.map(item =>
        `${item.name}: ${item.values.map((value, index) => `${months[index]} ${adminMoney(value)}`).join(', ')}`
    ).map(escapeAdmin).join('; ');

    target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="performanceMonthlySalesTitle performanceMonthlySalesDescription">
        <title id="performanceMonthlySalesTitle">Monthly sales per branch for ${escapeAdmin(year)}</title>
        <desc id="performanceMonthlySalesDescription">${description}</desc>
        <text class="chart-axis-label" x="20" y="${height / 2}" text-anchor="middle" transform="rotate(-90 20 ${height / 2})">Total sales (₱)</text>
        ${grid}${lines}${monthLabels}
    </svg><div class="performance-chart-legend">${legend}</div>`;
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message || 'Updated';
    toast.style.display = 'block';
    setTimeout(() => toast.style.display = 'none', 2500);
}
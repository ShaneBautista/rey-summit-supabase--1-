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
    out_for_delivery: {
        status: 'completed',
        label: 'Mark delivered'
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

    expectedOrder.forEach(page => {
        const link = linksByPage.get(page);
        if (link) {
            link.classList.toggle('active', location.pathname.endsWith(page));
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
        if (page === 'forecasting') renderForecast(data);
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
    drawInventory('all');
}

function drawInventory(filter = document.getElementById('inventoryFilter').value) {
    const normalizedFilter = filter === 'low' || filter === 'healthy' ? filter : 'all';
    const rows = inventoryProducts.filter(product => {
        const active = Number(product.is_active) === 1;
        return active && (normalizedFilter === 'all' || (normalizedFilter === 'low' && Number(product.stock_qty) <= 10) || (normalizedFilter === 'healthy' && Number(product.stock_qty) > 10));
    });
    document.getElementById('inventoryTable').innerHTML = rows.length ? `<div class="table-scroll"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(product => `<tr class="${Number(product.stock_qty) <= 10 && Number(product.is_active) ? 'stock-low' : ''}"><td><strong>${escapeAdmin(product.product_name)}</strong>${product.description ? `<small class="product-description">${escapeAdmin(product.description)}</small>` : ''}</td><td>${escapeAdmin(product.category_name || 'Uncategorised')}</td><td>${adminMoney(product.price)}</td><td class="stock-count">${product.stock_qty}</td><td>${Number(product.stock_qty) <= 10 ? 'Restock soon' : 'Healthy'}</td><td class="product-actions">${inventoryBranch === 'all' ? '—' : `<button type="button" class="text-button" data-edit="${product.product_id}">Edit</button><button type="button" class="text-button danger" data-delete="${product.product_id}">Delete</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No products match this filter.</p>';
    document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => editProduct(button.dataset.edit)));
    document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => deleteProduct(button.dataset.delete)));
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

async function deleteProduct(id) {
    if (inventoryBranch === 'all') return;
    const product = inventoryProducts.find(item => String(item.product_id) === String(id));
    if (!product || !window.confirm(`Remove “${product.product_name}” from ${inventoryBranch}'s catalogue?`)) return;
    try {
        const response = await rsmApi('admin_products.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'delete',
                product_id: id
            })
        });
        const result = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!result.success) throw new Error(result.message);
        await loadInventory();
        showToast(result.message);
    } catch (error) {
        document.getElementById('pageMessage').textContent = error.message || 'Could not delete product.';
    }
}

function renderOverview(data) {
    renderDecisionSupport(data);
    loadOverviewBranchInsight(data.branch);
    setupOverviewDateFilter();
}

let overviewAnalyticsRequest = 0;

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
        status.textContent = '';
    } catch (error) {
        if (request === overviewAnalyticsRequest) status.textContent = error.message || 'Overview analytics are unavailable.';
    } finally {
        if (request === overviewAnalyticsRequest) apply.disabled = false;
    }
}

function renderDecisionSupport(data) {
    const target = document.getElementById('dssInsights');
    const products = data.forecast_products || [];
    const recommendations = [];
    const hasForecastHistory = products.some(product => Number(product.historical_units || 0) > 0);
    const restockProducts = products
        .filter(product => Number(product.restock_units || 0) > 0)
        .sort((first, second) => Number(second.restock_units) - Number(first.restock_units));
    const lowStockProducts = products.filter(product => Number(product.stock_qty || 0) <= 10);
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
    const labelInterval = Math.ceil(buckets.length / 8);
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

function renderForecast(data) {
    const forecastProducts = data.forecast_products || [];
    const forecastUnits = forecastProducts.reduce((total, product) => total + Number(product.forecast_units || 0), 0);
    const forecastValue = forecastProducts.reduce((total, product) => total + (Number(product.forecast_units || 0) * Number(product.price || 0)), 0);
    const restockProducts = forecastProducts.filter(product => Number(product.restock_units || 0) > 0);
    const maxForecast = forecastProducts.length ? Math.max(...forecastProducts.map(product => Number(product.forecast_units || 0)), 1) : 1;
    document.querySelector('#forecastRevenue').previousElementSibling.textContent = 'Projected 7-day demand value';
    document.querySelector('#forecastRevenue').nextElementSibling.textContent = 'Based on historical sales trend';
    document.querySelector('#forecastOrders').previousElementSibling.textContent = 'Projected 7-day units';
    document.querySelector('#forecastOrders').nextElementSibling.textContent = 'Linear regression estimate';
    document.getElementById('forecastRevenue').textContent = adminMoney(forecastValue);
    document.getElementById('forecastOrders').textContent = forecastUnits.toLocaleString();
    const accuracy = data.forecast_accuracy || {};
    const hasAccuracy = Number.isFinite(Number(accuracy.mae)) && Number(accuracy.observations) > 0;
    const evaluatedProducts = Number(accuracy.evaluated_products);
    document.getElementById('forecastMae').textContent = hasAccuracy ? `${Number(accuracy.mae).toFixed(2)} units` : 'N/A';
    document.getElementById('forecastMaeNote').textContent = hasAccuracy ?
        `Avg units error / product-day · ${evaluatedProducts} product${evaluatedProducts === 1 ? '' : 's'}` :
        'No sales available for backtesting';
    document.querySelector('#categoryBars').previousElementSibling.textContent = 'Product demand forecast';
    const hasForecastHistory = forecastProducts.some(product => Number(product.historical_units || 0) > 0);
    document.getElementById('categoryBars').innerHTML = !forecastProducts.length ?
        '<p class="empty">No active products are available for forecasting.</p>' :
        !hasForecastHistory ?
        '<p class="empty">No product sales were recorded in the 28-day forecast period, so a reliable demand forecast is not available.</p>' :
        forecastProducts.slice().sort((first, second) => Number(second.forecast_units || 0) - Number(first.forecast_units || 0)).slice(0, 8).map(product => `<div class="bar-row"><span>${escapeAdmin(product.product_name)}</span><div class="bar"><i style="width:${Math.round((Number(product.forecast_units || 0) / maxForecast) * 100)}%"></i></div><strong>${Number(product.forecast_units || 0)} units${Number(product.restock_units || 0) ? ` · <span class="stock-count">Review restock of ${Number(product.restock_units)}</span>` : ''}</strong></div>`).join('');
    document.getElementById('forecastInsight').innerHTML = !hasForecastHistory ?
        '<strong>Forecast limits:</strong> No product sales were recorded in the 28-day forecast period, so a reliable demand estimate is not available. Review sales history; the Admin/Owner makes the final stock decision.' :
        restockProducts.length ?
        `<strong>Decision cue:</strong> ${restockProducts.length} product${restockProducts.length === 1 ? '' : 's'} may need a stock review for the next 7 days. The estimate uses 28 days of daily historical sales and linear regression, not an external AI service. Use it as a guide; the Admin/Owner decides whether to restock.` :
        '<strong>Demand signal:</strong> current stock appears sufficient for the projected next 7 days. The estimate uses 28 days of daily historical sales and linear regression, not an external AI service. Use it as a guide; the Admin/Owner decides whether to restock.';
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
        const rows = dayOrders.map(order => `<tr>
            <td>${escapeAdmin(order.sale_number || `#${order.order_id}`)}</td>
            <td>${escapeAdmin(order.sale_type || 'Online')}</td>
            <td>${escapeAdmin(order.username)}</td>
            <td>${escapeAdmin(order.location || '—')}</td>
            <td>${escapeAdmin(order.payment_method)}</td>
            <td>${escapeAdmin(order.delivered_by)}</td>
            <td class="sales-amount">${adminMoney(order.total_amount)}</td>
            <td><time>${escapeAdmin(order.order_time)}</time></td>
        </tr>`).join('');

        return `<section class="sales-day-group" aria-label="Sales for ${escapeAdmin(formattedDate)}">
            <div class="sales-day-heading"><h4>${escapeAdmin(formattedDate)}</h4><span aria-hidden="true">·</span><strong>Total: ${adminMoney(dailyTotal)}</strong></div>
            <div class="table-scroll">
                <table class="sales-table">
                    <colgroup>
                        <col class="sales-order-column">
                        <col class="sales-type-column">
                        <col class="sales-customer-column">
                        <col class="sales-location-column">
                        <col class="sales-payment-column">
                        <col class="sales-delivered-column">
                        <col class="sales-total-column">
                        <col class="sales-time-column">
                    </colgroup>
                    <thead><tr><th>Order #</th><th>Type</th><th>Customer</th><th>Location</th><th>Payment</th><th>Delivered By</th><th>Total</th><th>Time</th></tr></thead>
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
        status.textContent = `Updated at ${new Date().toLocaleTimeString()}. Refreshes every 15 seconds.`;
    } catch (error) {
        if (request !== performanceAnalyticsRequest) return;
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

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message || 'Updated';
    toast.style.display = 'block';
    setTimeout(() => toast.style.display = 'none', 2500);
}
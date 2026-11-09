const staffMoney = value => `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const staffEscape = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }));
const staffStatusLabels = { pending:'Pending', confirmed:'Confirmed', preparing:'Preparing', out_for_delivery:'Out for delivery', completed:'Delivered' };
let staffOrders = [];

document.addEventListener('DOMContentLoaded', () => {
    const reportDate = document.getElementById('reportDate');
    reportDate.textContent = new Date().toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric', year:'numeric' });
    wireStaffLogoutConfirmation();
    const openCancelConfirmation = wireStaffCancelConfirmation();
    document.getElementById('refreshStaffOrders').addEventListener('click', loadStaffOrders);
    document.getElementById('staffOrderQueue').addEventListener('click', event => {
        const reviewButton = event.target.closest('[data-review-decision]');
        if (reviewButton) {
            reviewGcashPayment(reviewButton.dataset.orderId, reviewButton.dataset.reviewDecision);
            return;
        }
        const cancelButton = event.target.closest('[data-cancel-order]');
        if (cancelButton) {
            openCancelConfirmation(cancelButton);
            return;
        }
        const button = event.target.closest('[data-next-status]');
        if (button) advanceStaffOrder(button.dataset.orderId, button.dataset.nextStatus);
    });
    loadStaffOrders();
});

function wireStaffCancelConfirmation() {
    const modal = document.createElement('div');
    modal.className = 'admin-logout-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'staffCancelTitle');
    modal.setAttribute('aria-describedby', 'staffCancelMessage');
    modal.innerHTML = `
        <div class="admin-logout-card">
            <h2 id="staffCancelTitle">Cancel order?</h2>
            <p id="staffCancelMessage"></p>
            <div class="admin-logout-actions">
                <button type="button" class="admin-logout-cancel">Keep order</button>
                <button type="button" class="admin-logout-confirm">Confirm</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const keepButton = modal.querySelector('.admin-logout-cancel');
    const confirmButton = modal.querySelector('.admin-logout-confirm');
    let activeCancelButton = null;

    const closeModal = () => {
        modal.classList.remove('open');
        if (activeCancelButton?.isConnected) activeCancelButton.focus();
        activeCancelButton = null;
    };

    keepButton.addEventListener('click', closeModal);
    confirmButton.addEventListener('click', () => {
        const orderId = activeCancelButton?.dataset.orderId;
        closeModal();
        if (orderId) cancelStaffOrder(orderId);
    });
    modal.addEventListener('click', event => {
        if (event.target === modal) closeModal();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && modal.classList.contains('open')) closeModal();
    });

    return cancelButton => {
        activeCancelButton = cancelButton;
        const orderNumber = String(cancelButton.dataset.orderId).padStart(6, '0');
        modal.querySelector('#staffCancelMessage').textContent =
            `Are you sure you want to cancel order #${orderNumber}? This action cannot be undone.`;
        modal.classList.add('open');
        keepButton.focus();
    };
}

function wireStaffLogoutConfirmation() {
    const logoutLinks = document.querySelectorAll('.aside-footer .logout');
    if (!logoutLinks.length) return;

    const modal = document.createElement('div');
    modal.className = 'admin-logout-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'staffLogoutTitle');
    modal.setAttribute('aria-describedby', 'staffLogoutMessage');
    modal.innerHTML = `
        <div class="admin-logout-card">
            <h2 id="staffLogoutTitle">Log out?</h2>
            <p id="staffLogoutMessage">Are you sure you want to log out of your staff account?</p>
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

async function loadStaffOrders() {
    const queue = document.getElementById('staffOrderQueue');
    queue.innerHTML = '<p class="empty">Loading order queue...</p>';
    try {
        const response = await rsmApi('staff_orders.php');
        const data = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!data.success) throw new Error(data.message || 'Could not load the order queue.');
        staffOrders = data.orders || [];
        const workspace = document.body.dataset.workspace;
        if (workspace && data.staff.role !== workspace) {
            window.location.replace(data.staff.role === 'sales' ? 'sales_staff.html' : 'delivery_staff.html');
            return;
        }
        const profileName = document.querySelector('.staff-profile strong');
        if (profileName) profileName.textContent = data.staff.name;
        const profileBranch = document.querySelector('.staff-profile span');
        if (profileBranch) profileBranch.textContent = `${data.staff.branch} · ${data.staff.role === 'sales' ? 'Sales staff' : 'Delivery staff'}`;
        renderStaffOrders(staffOrders, data.staff.role);
    } catch (error) {
        queue.innerHTML = `<p class="empty">${staffEscape(error.message || 'Could not load the order queue.')}</p>`;
    }
}

function renderStaffOrders(orders, role) {
    if (role === 'sales') {
        document.getElementById('staffOpenCount').textContent = orders.length.toLocaleString();
        document.getElementById('staffPendingCount').textContent = orders.filter(order => order.order_status === 'pending').length.toLocaleString();
        document.getElementById('staffConfirmedCount').textContent = orders.filter(order => order.order_status === 'confirmed').length.toLocaleString();
    } else {
        document.getElementById('staffOpenCount').textContent = orders.length.toLocaleString();
        document.getElementById('staffTodayCount').textContent = orders.filter(order => order.order_day === staffToday()).length.toLocaleString();
        document.getElementById('staffQueueValue').textContent = staffMoney(orders.reduce((total, order) => total + Number(order.total_amount || 0), 0));
    }

    const queue = document.getElementById('staffOrderQueue');
    if (!orders.length) {
        queue.innerHTML = `<div class="staff-empty"><strong>${role === 'sales' ? 'Your order queue is clear.' : 'No deliveries are waiting.'}</strong><span>${role === 'sales' ? 'Refresh this page to check for new orders.' : 'Prepared orders from sales will appear here.'}</span></div>`;
        return;
    }

    queue.innerHTML = `<div class="staff-order-grid">${orders.map(order => renderStaffOrder(order, role)).join('')}</div>`;
}

function renderStaffOrder(order, role) {
    const next = role === 'sales'
        ? { pending:'confirmed', confirmed:'preparing' }[order.order_status]
        : { preparing:'out_for_delivery', out_for_delivery:'completed' }[order.order_status];
    const needsGcashReview = role === 'sales' && order.order_status === 'pending'
        && order.payment_method === 'GCash' && order.payment_verification_status !== 'approved';
    const action = next && !needsGcashReview
        ? `<button type="button" class="staff-next-button" data-order-id="${Number(order.order_id)}" data-next-status="${next}">${role === 'sales' ? (next === 'confirmed' ? 'Confirm order' : 'Start preparing') : (next === 'out_for_delivery' ? 'Mark out for delivery' : 'Mark delivered')}</button>`
        : '';
    const paymentStatus = order.payment_verification_status || 'not_required';
    const paymentReview = role === 'sales' && order.payment_method === 'GCash'
        ? `<section class="staff-payment-verification">
            <div class="staff-payment-heading"><strong>GCash payment proof</strong><span class="staff-payment-status ${staffEscape(paymentStatus)}">${staffEscape(paymentStatus === 'approved' ? 'Approved' : paymentStatus === 'rejected' ? 'Rejected' : 'Pending')}</span></div>
            <div class="staff-payment-reference"><span>Reference</span><strong>${staffEscape(order.gcash_reference || '—')}</strong></div>
            ${order.proof_url
                ? `<a class="staff-proof-link" href="${staffEscape(order.proof_url)}" target="_blank" rel="noopener"><img src="${staffEscape(order.proof_url)}" alt="GCash proof for order #${Number(order.order_id)}"></a>`
                : '<p class="staff-proof-missing">No proof image was uploaded.</p>'}
            ${order.order_status === 'pending' && paymentStatus === 'pending' && order.has_payment_proof
                ? `<div class="staff-payment-actions"><button type="button" class="staff-payment-approve" data-order-id="${Number(order.order_id)}" data-review-decision="approve">Approve</button><button type="button" class="staff-payment-reject" data-order-id="${Number(order.order_id)}" data-review-decision="reject">Reject</button></div>`
                : ''}
        </section>`
        : '';
    const reviewHint = needsGcashReview
        ? `<p class="staff-payment-hint">${paymentStatus === 'rejected' ? 'Payment proof was rejected. Waiting for the customer to submit new proof.' : 'Approve the GCash payment proof before confirming this order.'}</p>`
        : '';
    const items = (order.items || []).map(item => `<div class="staff-order-item"><span>${staffEscape(item.product_name)} × ${Number(item.quantity)}</span><strong>${staffMoney(Number(item.unit_price) * Number(item.quantity))}</strong></div>`).join('');
    const timestamp = new Date(`${order.order_day}T${toTwentyFourHourTime(order.order_time)}`);
    const formattedDate = Number.isNaN(timestamp.getTime())
        ? staffEscape(order.order_day)
        : timestamp.toLocaleString(undefined, { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });

    return `<article class="staff-order-card">
        <div class="staff-order-head">
            <div><h4>#${String(order.order_id).padStart(6, '0')}</h4><time>${formattedDate}</time></div>
            <div class="staff-order-head-actions">
                <span class="status-badge status-${staffEscape(order.order_status)}">${staffEscape(staffStatusLabels[order.order_status] || order.order_status)}</span>
                <button type="button" class="staff-cancel-button" data-order-id="${Number(order.order_id)}" data-cancel-order aria-label="Cancel order #${Number(order.order_id)}">Cancel</button>
            </div>
        </div>
        <div class="staff-order-details">
            <div><span>Customer</span><strong>${staffEscape(order.username)}</strong></div>
            <div><span>Contact</span><strong>${staffEscape(order.contact_phone || order.phone)}</strong></div>
            <div><span>Payment</span><strong>${staffEscape(order.payment_method)}</strong></div>
            <div class="staff-order-address"><span>Delivery address</span><strong>${staffEscape(order.delivery_address)}</strong></div>
        </div>
        <div class="staff-order-items">${items || '<span>No line items found.</span>'}</div>
        <div class="staff-order-footer"><strong>Total</strong><strong>${staffMoney(order.total_amount)}</strong></div>
        ${paymentReview}
        ${reviewHint}
        ${action}
    </article>`;
}

function toTwentyFourHourTime(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return '00:00:00';
    let hour = Number(match[1]) % 12;
    if (match[3].toUpperCase() === 'PM') hour += 12;
    return `${String(hour).padStart(2, '0')}:${match[2]}:00`;
}

function staffToday() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function advanceStaffOrder(orderId, status) {
    await updateStaffOrder(orderId, status, 'data-next-status', 'Could not update the order.');
}

async function cancelStaffOrder(orderId) {
    await updateStaffOrder(orderId, 'cancelled', 'data-cancel-order', 'Could not cancel the order.');
}

async function updateStaffOrder(orderId, status, actionAttribute, fallbackMessage) {
    const buttons = document.querySelectorAll(`[data-order-id="${CSS.escape(orderId)}"][${actionAttribute}]`);
    buttons.forEach(button => { button.disabled = true; });
    try {
        const response = await rsmApi('staff_update_order.php', {
            method: 'POST',
            body: new URLSearchParams({ order_id: orderId, status }),
        });
        const result = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!result.success) throw new Error(result.message || fallbackMessage);
        showStaffToast(result.message);
        await loadStaffOrders();
    } catch (error) {
        document.getElementById('staffMessage').textContent = error.message || fallbackMessage;
        buttons.forEach(button => { button.disabled = false; });
        if (error.message && error.message.includes('changed')) await loadStaffOrders();
    }
}

async function reviewGcashPayment(orderId, decision) {
    const buttons = document.querySelectorAll(`[data-order-id="${CSS.escape(orderId)}"][data-review-decision]`);
    buttons.forEach(button => { button.disabled = true; });
    try {
        const response = await rsmApi('staff_update_order.php', {
            method: 'POST',
            body: new URLSearchParams({ order_id: orderId, payment_decision: decision }),
        });
        const result = await response.json();
        if (response.status === 401) {
            window.location.href = 'Admin_login.html';
            return;
        }
        if (!result.success) throw new Error(result.message || 'Could not review the payment proof.');
        showStaffToast(result.message);
        await loadStaffOrders();
    } catch (error) {
        document.getElementById('staffMessage').textContent = error.message || 'Could not review the payment proof.';
        buttons.forEach(button => { button.disabled = false; });
        if (error.message && error.message.includes('no longer')) await loadStaffOrders();
    }
}

function showStaffToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

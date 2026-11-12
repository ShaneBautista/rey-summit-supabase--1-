// ============================================
// tracking.js
// Looks up one order (get_order.php) and renders it two
// ways from the same data: a desktop "shipping label +
// timeline" layout, and a mobile step-card layout. CSS
// (see shop.css) decides which one is visible.
// ============================================

const money = (n) => '₱' + Number(n).toFixed(2);

const STAGES = [
    { key: 'pending',           title: 'Order Placed',     desc: 'We received your order.' },
    { key: 'confirmed',         title: 'Confirmed',        desc: 'Your order has been confirmed.' },
    { key: 'preparing',         title: 'Preparing',        desc: 'Your order is being prepared.' },
    { key: 'out_for_delivery',  title: 'Out for Delivery', desc: 'Your order is on its way.' },
    { key: 'completed',         title: 'Delivered',        desc: 'Your order has been delivered.' },
];

document.addEventListener('DOMContentLoaded', () => {
    loadCustomerUsername();

    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order_id');

    document.getElementById('shipRefreshBtn').addEventListener('click', () => {
        if (orderId) loadOrder(orderId);
    });

    if (orderId) {
        loadOrder(orderId);
    } else {
        loadMyOrders();
    }
});

async function loadCustomerUsername() {
    try {
        const response = await rsmApi('customer_account.php');
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Could not load your account details.');
        }
        document.getElementById('customerUsername').textContent = data.account.username || '';
    } catch (error) {
        console.error('Could not load the customer username for order tracking.', error);
    }
}

async function loadMyOrders() {
    const box = document.getElementById('ordersListBox');
    try {
        const res = await rsmApi('get_my_orders.php?tracking=1');
        const data = await res.json();

        if (!data.success) {
            box.innerHTML = `<p style="color:var(--muted); font-size:.9rem;">Please <a href="Customer_Login.html">log in</a> to see your recent orders.</p>`;
            return;
        }

        const trackableOrders = data.orders.filter(order =>
            order.order_status !== 'cancelled' && order.order_status !== 'completed'
        );
        if (trackableOrders.length === 0) {
            box.innerHTML = `<p style="color:var(--muted); font-size:.9rem;">You have no orders to track.</p>`;
            return;
        }

        box.innerHTML = `<div class="orders-list">` + trackableOrders.map(o => `
            <a href="track_order.html?order_id=${o.order_id}">
                <span>Order #${String(o.order_id).padStart(6, '0')} · ${money(o.total_amount)}</span>
                <span class="badge ${o.order_status}">${statusLabel(o.order_status)}</span>
            </a>`).join('') + `</div>`;
    } catch (err) {
        box.innerHTML = `<p style="color:var(--muted); font-size:.9rem;">Could not load your orders. Please try again.</p>`;
    }
}

async function loadOrder(orderId) {
    const loadingBox = document.getElementById('loadingBox');
    const errorBox = document.getElementById('errorBox');
    const wrap = document.getElementById('trackingWrap');
    const listBox = document.getElementById('ordersListBox');

    listBox.innerHTML = '';
    wrap.classList.remove('ready');
    errorBox.style.display = 'none';
    loadingBox.style.display = 'block';

    try {
        const res = await rsmApi(`get_order.php?order_id=${encodeURIComponent(orderId)}`);
        const data = await res.json();

        loadingBox.style.display = 'none';

        if (!data.success) {
            errorBox.style.display = 'block';
            errorBox.textContent = data.message || 'Order not found.';
            return;
        }

        if (data.order.order_status === 'cancelled') {
            errorBox.style.display = 'block';
            errorBox.textContent = 'This order was cancelled and is no longer being tracked. You can still view it in order history.';
            return;
        }

        if (data.order.order_status === 'completed') {
            errorBox.style.display = 'block';
            errorBox.textContent = 'This order has been delivered and is no longer being tracked. You can still view it in order history.';
            return;
        }

        renderShipCard(data.order);
        renderTimeline(data.order);
        renderMobileStepper(data.order);
        wrap.classList.add('ready');

    } catch (err) {
        loadingBox.style.display = 'none';
        errorBox.style.display = 'block';
        errorBox.textContent = 'Could not reach the server. Please try again.';
    }
}

function statusLabel(status) {
    if (status === 'cancelled') return 'Cancelled';
    const stage = STAGES.find(s => s.key === status);
    return stage ? stage.title : status;
}

function renderShipCard(order) {
    const statusIndex = currentIndex(order.order_status);
    const progress = order.order_status === 'completed'
        ? 100
        : order.order_status === 'cancelled'
            ? 0
            : Math.max(8, (statusIndex / (STAGES.length - 1)) * 100);

    document.getElementById('shipOrderId').textContent = 'Tracking No: #' + String(order.order_id).padStart(6, '0');
    document.getElementById('shipStatusBig').textContent = statusLabel(order.order_status);
    document.getElementById('shipStatusSub').textContent = `Last updated · ${formatDate(order.order_date)}`;
    document.getElementById('shipCustomer').textContent = order.username;
    document.getElementById('shipAddress').textContent = order.delivery_address;
    document.getElementById('shipTotal').textContent = money(order.total_amount);
    document.getElementById('shipReceiptLink').href = `order_confirmation.html?order_id=${order.order_id}`;
    document.getElementById('routeProgress').style.width = `${progress}%`;
    document.getElementById('routeRunner').dataset.status = order.order_status;
    document.getElementById('routeCaption').textContent = order.order_status === 'cancelled'
        ? 'Shipment cancelled'
        : order.order_status === 'completed'
            ? 'Delivered to destination'
            : `${statusLabel(order.order_status)} · shipment in progress`;

    document.getElementById('shipStatusBig').style.color =
        order.order_status === 'cancelled' ? 'var(--danger)' : 'var(--ink)';
}

function currentIndex(status) {
    return STAGES.findIndex(s => s.key === status);
}

function renderTimeline(order) {
    const list = document.getElementById('timelineList');

    if (order.order_status === 'cancelled') {
        list.innerHTML = `
            <li class="done"><div class="t-title">Order Placed</div><div class="t-desc">We received your order.</div></li>
            <li class="current"><div class="t-title" style="color:var(--danger)">Order Cancelled</div><div class="t-desc">This order was cancelled.</div></li>`;
        return;
    }

    const idx = currentIndex(order.order_status);
    list.innerHTML = STAGES.map((s, i) => {
        let cls = '';
        if (order.order_status === 'completed') {
            cls = 'done';
        } else if (i < idx) {
            cls = 'done';
        } else if (i === idx) {
            cls = 'current';
        }
        return `
            <li class="${cls}">
                <div class="t-title">${s.title}</div>
                <div class="t-desc">${s.desc}</div>
                ${i === idx ? `<div class="t-time">${formatDate(order.order_date)}</div>` : ''}
            </li>`;
    }).join('');
}

function renderMobileStepper(order) {
    const body = document.getElementById('mobileStepperBody');

    if (order.order_status === 'cancelled') {
        body.innerHTML = `
            <div class="mobile-step done">
                <div class="dot-col"><div class="dot">✓</div><div class="stem"></div></div>
                <div><div class="ms-title">Order Placed</div><div class="ms-desc">We received your order.</div></div>
            </div>
            <div class="mobile-step current">
                <div class="dot-col"><div class="dot">✕</div></div>
                <div><div class="ms-title" style="color:var(--danger)">Order Cancelled</div><div class="ms-desc">This order was cancelled.</div></div>
            </div>`;
        return;
    }

    const idx = currentIndex(order.order_status);
    body.innerHTML = STAGES.map((s, i) => {
        const isLast = i === STAGES.length - 1;
        let stateClass = '';
        let dotContent = i + 1;
        if (order.order_status === 'completed') {
            stateClass = 'done'; dotContent = '✓';
        } else if (i < idx) {
            stateClass = 'done'; dotContent = '✓';
        } else if (i === idx) {
            stateClass = 'current';
        }
        return `
            <div class="mobile-step ${stateClass}">
                <div class="dot-col">
                    <div class="dot">${dotContent}</div>
                    ${!isLast ? '<div class="stem"></div>' : ''}
                </div>
                <div>
                    ${i === idx ? `<div class="ms-time">${formatDate(order.order_date)}</div>` : ''}
                    <div class="ms-title">${s.title}</div>
                    <div class="ms-desc">${s.desc}</div>
                </div>
            </div>`;
    }).join('');
}

function formatDate(str) {
    const d = new Date(str.replace(' ', 'T'));
    if (isNaN(d)) return str;
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

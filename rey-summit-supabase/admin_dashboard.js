const money = value => `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusLabels = { pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', out_for_delivery: 'Out for delivery', cancelled: 'Cancelled' };

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('reportDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    try {
        const response = await rsmApi('admin_dashboard_data.php');
        const data = await response.json();
        if (response.status === 401) { window.location.href = 'Admin_login.html'; return; }
        if (!data.success) throw new Error(data.message);
        renderDashboard(data);
    } catch (error) { document.getElementById('insight').textContent = error.message || 'Dashboard data is unavailable.'; }
});

function renderDashboard(data) {
    const monthly = data.monthly || {}, recent = data.recent || {};
    document.getElementById('adminName').textContent = data.admin.name || 'Admin';
    document.getElementById('adminGreeting').textContent = `Signed in as ${data.admin.name || 'administrator'}`;
    document.getElementById('revenue').textContent = money(monthly.revenue);
    document.getElementById('orders').textContent = Number(monthly.order_count || 0).toLocaleString();
    document.getElementById('deliveries').textContent = data.open_deliveries;
    const lowStock = data.products.filter(product => Number(product.stock_qty) <= 10);
    document.getElementById('lowStock').textContent = lowStock.length;
    document.getElementById('revenueNote').textContent = `${money(recent.revenue)} in the last 7 days`;
    document.getElementById('ordersNote').textContent = `${recent.order_count || 0} orders in the last 7 days`;
    document.getElementById('forecastRevenue').textContent = money(Number(recent.revenue || 0));
    document.getElementById('forecastOrders').textContent = Math.round(Number(recent.order_count || 0));
    document.getElementById('forecastRevenueNote').textContent = '7-day run rate';
    document.getElementById('forecastOrdersNote').textContent = '7-day run rate';
    renderInventory(data.products, lowStock);
    renderCategories(data.categories || []);
    renderDelivery(data.orders || []);
    const fulfillment = Number(data.fulfillment_rate || 0);
    document.getElementById('fulfillmentBar').style.width = `${fulfillment}%`;
    document.getElementById('fulfillmentRate').textContent = `${fulfillment}%`;
    const goalPercent = Math.min(100, Math.round((Number(monthly.revenue || 0) / 100000) * 100));
    document.getElementById('revenueBar').style.width = `${goalPercent}%`;
    document.getElementById('revenueGoal').textContent = `${goalPercent}%`;
    document.getElementById('insight').innerHTML = lowStock.length ? `<strong>Decision cue:</strong> ${lowStock.length} item${lowStock.length === 1 ? '' : 's'} need restocking before the next demand cycle.` : '<strong>Decision cue:</strong> Stock levels are healthy. Keep monitoring the 7-day demand run rate.';
}

function renderInventory(products, lowStock) {
    const list = document.getElementById('stockList');
    const items = lowStock.length ? lowStock : products.slice(0, 5);
    list.innerHTML = items.length ? items.map(product => `<div class="stock-item"><span>${escapeHtml(product.product_name)}</span><span class="stock-count">${product.stock_qty} left</span></div>`).join('') : '<div class="empty">No active products found.</div>';
}

function renderCategories(categories) {
    const target = document.getElementById('categoryBars');
    if (!categories.length) { target.innerHTML = '<div class="empty">Not enough order history for category analysis.</div>'; return; }
    const max = Math.max(...categories.map(category => Number(category.units)));
    target.innerHTML = categories.map(category => `<div class="bar-row"><span>${escapeHtml(category.category_name)}</span><div class="bar"><i style="width:${Math.round((category.units / max) * 100)}%"></i></div><strong>${category.units} units</strong></div>`).join('');
}

function renderDelivery(orders) {
    const target = document.getElementById('deliveryTable');
    const active = orders.filter(order => order.order_status !== 'completed' && order.order_status !== 'cancelled').slice(0, 8);
    if (!active.length) { target.innerHTML = '<div class="empty">No active orders need a delivery update.</div>'; return; }
    target.innerHTML = `<table><thead><tr><th>Order</th><th>Customer</th><th>Status</th></tr></thead><tbody>${active.map(order => `<tr><td>#${String(order.order_id).padStart(6, '0')}</td><td>${escapeHtml(order.username)}</td><td><select class="status" data-order-id="${order.order_id}">${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${value === order.order_status ? 'selected' : ''}>${label}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>`;
    target.querySelectorAll('select').forEach(select => select.addEventListener('change', () => updateOrder(select)));
}

async function updateOrder(select) {
    const body = new URLSearchParams({ order_id: select.dataset.orderId, status: select.value });
    const response = await rsmApi('admin_update_order.php', { method: 'POST', body });
    const data = await response.json();
    showToast(data.message || 'Order updated.');
    if (data.success) setTimeout(() => window.location.reload(), 500);
}

function showToast(message) { const toast = document.getElementById('toast'); toast.textContent = message; toast.style.display = 'block'; setTimeout(() => { toast.style.display = 'none'; }, 2500); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'\"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[character])); }

const historyMoney = (value) => '₱' + Number(value).toFixed(2);

const historyStatusLabel = (status) => {
    const labels = {
        pending: 'Order placed',
        confirmed: 'Confirmed',
        preparing: 'Preparing',
        out_for_delivery: 'Out for delivery',
        completed: 'Delivered',
        cancelled: 'Cancelled'
    };
    return labels[status] || status;
};

document.addEventListener('DOMContentLoaded', async () => {
    const message = document.getElementById('historyMessage');
    const list = document.getElementById('historyList');

    try {
        const response = await rsmApi('get_my_orders.php');
        const data = await response.json();

        if (!data.success) {
            message.className = 'error-state';
            message.textContent = data.message || 'Please log in to view your order history.';
            return;
        }

        message.style.display = 'none';
        if (data.orders.length === 0) {
            message.className = 'loading-state';
            message.textContent = 'You have no previous orders.';
            message.style.display = 'block';
            return;
        }

        list.innerHTML = data.orders.map(order => `
            <article class="history-item">
                <div class="history-item-main">
                    <div class="history-order-number">Order #${String(order.order_id).padStart(6, '0')}</div>
                    <div class="history-date">${formatHistoryDate(order.order_date)}</div>
                </div>
                <div class="history-item-status">
                    <span class="badge ${order.order_status}">${historyStatusLabel(order.order_status)}</span>
                    <strong>${historyMoney(order.total_amount)}</strong>
                </div>
                ${order.order_status === 'pending' && order.payment_method === 'gcash' && order.payment_verification_status === 'rejected'
                    ? `<a class="history-track" href="order_confirmation.html?order_id=${encodeURIComponent(order.order_id)}">Update payment proof</a>`
                    : order.order_status === 'cancelled'
                    ? '<span class="history-track">Tracking closed</span>'
                    : `<a class="history-track" href="track_order.html?order_id=${encodeURIComponent(order.order_id)}">View tracking</a>`}
            </article>
        `).join('');
    } catch (error) {
        message.className = 'error-state';
        message.textContent = 'Could not load your order history. Please try again.';
    }
});

function formatHistoryDate(value) {
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

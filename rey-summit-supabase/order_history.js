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

    list.addEventListener('click', event => {
        const button = event.target.closest('.history-receipt-trigger');
        if (button) viewHistoryReceipt(button.dataset.orderId, button);
    });
    document.getElementById('backToHistory').addEventListener('click', () => {
        document.getElementById('historyReceiptView').style.display = 'none';
        document.getElementById('historyContent').style.display = '';
        document.getElementById('historyContent').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    try {
        const accountResponse = await rsmApi('customer_account.php');
        const accountData = await accountResponse.json();
        if (!accountResponse.ok || !accountData.success) {
            throw new Error(accountData.message || 'Could not load your account details.');
        }
        document.getElementById('customerUsername').textContent = accountData.account.username || '';

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
                    : (order.order_status === 'cancelled' || order.order_status === 'completed')
                    ? `<button type="button" class="history-track history-receipt-trigger" data-order-id="${encodeURIComponent(order.order_id)}">View</button>`
                    : `<a class="history-track" href="track_order.html?order_id=${encodeURIComponent(order.order_id)}">View tracking</a>`}
            </article>
        `).join('');
    } catch (error) {
        message.className = 'error-state';
        message.textContent = error.message || 'Could not load your order history. Please try again.';
    }
});

async function viewHistoryReceipt(orderId, trigger) {
    const receiptView = document.getElementById('historyReceiptView');
    const receipt = document.getElementById('historyReceipt');
    const error = document.getElementById('historyReceiptError');

    error.style.display = 'none';
    receipt.style.display = 'none';
    trigger.disabled = true;

    try {
        const response = await rsmApi(`get_order.php?order_id=${encodeURIComponent(orderId)}`);
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Could not load this order receipt.');
        }

        renderHistoryReceipt(data.order, data.items || []);
        document.getElementById('historyContent').style.display = 'none';
        receiptView.style.display = 'block';
        receipt.style.display = 'block';
        receiptView.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (requestError) {
        document.getElementById('historyContent').style.display = 'none';
        receiptView.style.display = 'block';
        error.textContent = requestError.message || 'Could not load this order receipt. Please try again.';
        error.style.display = 'block';
    } finally {
        trigger.disabled = false;
    }
}

function renderHistoryReceipt(order, items) {
    document.getElementById('historyReceiptOrderId').textContent =
        '#' + String(order.order_id).padStart(6, '0');
    document.getElementById('historyReceiptDate').textContent = formatHistoryDate(order.order_date);
    document.getElementById('historyReceiptStatus').textContent = historyStatusLabel(order.order_status);
    document.getElementById('historyReceiptAddress').textContent = order.delivery_address || '—';
    document.getElementById('historyReceiptTotal').textContent = historyMoney(order.total_amount);

    const deliveredByName = order.delivered_by_name || '';
    document.getElementById('historyDeliveredByRow').style.display =
        order.order_status === 'completed' && deliveredByName ? 'flex' : 'none';
    document.getElementById('historyDeliveredBy').textContent = deliveredByName;
    document.getElementById('historyReceiptItems').innerHTML = items.map(item => `
        <div class="receipt-item">
            <span class="ri-name">${escapeHistoryHtml(item.product_name)} <span class="ri-qty">× ${escapeHistoryHtml(item.quantity)}</span></span>
            <span>${historyMoney(item.subtotal)}</span>
        </div>`).join('');
}

function escapeHistoryHtml(value) {
    const element = document.createElement('span');
    element.textContent = value == null ? '' : String(value);
    return element.innerHTML;
}

function formatHistoryDate(value) {
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

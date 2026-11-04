// ============================================
// confirmation.js
// Reads ?order_id= from the URL, calls get_order.php,
// then fills BOTH the mobile e-receipt markup and the
// desktop shipping-label markup — CSS decides which one
// is actually shown at a given screen width.
// ============================================

const money = (n) => '₱' + Number(n).toFixed(2);

const STATUS_LABELS = {
    pending: 'Order Placed',
    confirmed: 'Confirmed',
    preparing: 'Preparing',
    out_for_delivery: 'Out for Delivery',
    completed: 'Delivered',
    cancelled: 'Cancelled',
};

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order_id');

    const loadingBox = document.getElementById('loadingBox');
    const errorBox = document.getElementById('errorBox');

    if (!orderId) {
        loadingBox.style.display = 'none';
        errorBox.style.display = 'block';
        errorBox.textContent = 'No order specified.';
        return;
    }

    try {
        const res = await rsmApi(`get_order.php?order_id=${encodeURIComponent(orderId)}`);
        const data = await res.json();

        loadingBox.style.display = 'none';

        if (!data.success) {
            errorBox.style.display = 'block';
            errorBox.textContent = data.message || 'Order not found.';
            return;
        }

        fillMobileReceipt(data.order, data.items);
        fillDesktopConfirmation(data.order, data.items);
        configurePaymentReview(data.order);

        document.getElementById('receiptCard').style.display = 'block';
        document.getElementById('desktopConfirm').style.display = 'grid';

    } catch (err) {
        loadingBox.style.display = 'none';
        errorBox.style.display = 'block';
        errorBox.textContent = 'Could not reach the server. Please try again.';
    }
});

function configurePaymentReview(order) {
    if (order.payment_method !== 'gcash') return;

    const panel = document.getElementById('paymentReviewMessage');
    const title = document.getElementById('paymentReviewTitle');
    const description = document.getElementById('paymentReviewDescription');
    const form = document.getElementById('replacementProofForm');
    const titleHeading = document.getElementById('confirmationTitle');
    const subtitle = document.getElementById('confirmationSubtitle');

    panel.style.display = 'block';
    if (order.order_status === 'cancelled') {
        title.textContent = 'Order cancelled';
        description.textContent = 'This order is closed. Contact sales staff if you need help with your payment.';
        titleHeading.textContent = 'Order cancelled';
        subtitle.textContent = 'This order is no longer waiting for payment verification.';
    } else if (order.payment_verification_status === 'approved') {
        title.textContent = 'GCash payment verified';
        description.textContent = 'Your payment has been approved. Sales staff will confirm your order shortly.';
        titleHeading.textContent = 'Payment verified';
        subtitle.textContent = 'Your GCash payment was received and verified.';
    } else if (order.payment_verification_status === 'rejected') {
        title.textContent = 'Please submit a new payment proof';
        description.textContent = 'Sales staff could not verify the submitted GCash payment. Upload a corrected receipt and reference number below.';
        form.style.display = 'block';
        form.addEventListener('submit', resubmitPaymentProof);
        titleHeading.textContent = 'Payment needs attention';
        subtitle.textContent = 'Your order will remain unconfirmed until a valid payment is verified.';
    } else {
        title.textContent = 'Payment verification pending';
        description.textContent = 'Your order is waiting for sales staff to verify your GCash payment before confirmation.';
        titleHeading.textContent = 'Order received';
        subtitle.textContent = 'Your GCash payment is waiting for manual verification.';
    }
}

async function resubmitPaymentProof(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById('replacementProofMessage');
    const button = form.querySelector('button[type="submit"]');
    const orderId = new URLSearchParams(window.location.search).get('order_id');
    const payload = new FormData(form);
    payload.append('order_id', orderId);
    button.disabled = true;
    message.textContent = '';

    try {
        const response = await rsmApi('resubmit_payment_proof.php', { method: 'POST', body: payload });
        const result = await response.json();
        if (!result.success) throw new Error(result.message || 'Could not submit your new proof.');
        message.textContent = result.message;
        message.className = 'form-message success';
        form.style.display = 'none';
        document.getElementById('paymentReviewTitle').textContent = 'Payment verification pending';
        document.getElementById('paymentReviewDescription').textContent = 'Your replacement proof is waiting for sales staff to verify your GCash payment.';
    } catch (error) {
        message.textContent = error.message || 'Could not submit your new proof. Please try again.';
        message.className = 'form-message error';
        button.disabled = false;
    }
}

function fillMobileReceipt(order, items) {
    const deliveredByName = order.delivered_by_name || '';
    document.getElementById('rOrderId').textContent = '#' + String(order.order_id).padStart(6, '0');
    document.getElementById('rDate').textContent = formatDate(order.order_date);
    document.getElementById('rStatus').textContent = STATUS_LABELS[order.order_status] || order.order_status;
    const deliveredRow = document.getElementById('rDeliveredByRow');
    const deliveredText = document.getElementById('rDeliveredBy');
    if (order.order_status === 'completed' && deliveredByName) {
        deliveredText.textContent = deliveredByName;
        deliveredRow.style.display = 'flex';
    } else {
        deliveredRow.style.display = 'none';
    }
    document.getElementById('rAddress').textContent = order.delivery_address;
    document.getElementById('rTotal').textContent = money(order.total_amount);
    document.getElementById('rItems').innerHTML = items.map(i => `
        <div class="receipt-item">
            <span class="ri-name">${escapeHtml(i.product_name)} <span class="ri-qty">× ${i.quantity}</span></span>
            <span>${money(i.subtotal)}</span>
        </div>`).join('');
}

function fillDesktopConfirmation(order, items) {
    const deliveredText = document.getElementById('dDeliveredBy');
    const deliveredByName = order.delivered_by_name || '';
    document.getElementById('dOrderId').textContent = 'Order #' + String(order.order_id).padStart(6, '0');
    document.getElementById('dStatus').textContent = `Status: ${STATUS_LABELS[order.order_status] || order.order_status} · Placed ${formatDate(order.order_date)}`;
    if (order.order_status === 'completed' && deliveredByName) {
        deliveredText.textContent = `Delivered by: ${deliveredByName}`;
        deliveredText.style.display = 'block';
    } else {
        deliveredText.style.display = 'none';
    }
    document.getElementById('dTrackLink').href = `track_order.html?order_id=${order.order_id}`;
    document.getElementById('dAddress').textContent = order.delivery_address;
    document.getElementById('dTotal').textContent = money(order.total_amount);

    document.getElementById('dItemsBody').innerHTML = items.map(i => `
        <tr>
            <td>${escapeHtml(i.product_name)}</td>
            <td>${i.quantity}</td>
            <td>${money(i.unit_price)}</td>
            <td>${money(i.subtotal)}</td>
        </tr>`).join('');
}

function formatDate(str) {
    const d = new Date(str.replace(' ', 'T'));
    if (isNaN(d)) return str;
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

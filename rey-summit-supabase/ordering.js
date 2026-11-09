// ============================================
// ordering.js
// Loads the product catalog from get_products.php,
// keeps a cart in memory, renders the cart drawer, then submits the order to
// place_order.php.
// ============================================

const money = (n) => '₱' + Number(n).toFixed(2);

let PRODUCTS = [];
let CART = {}; // product_id -> { product, quantity }
let cartSaveQueue = Promise.resolve();
let cartSyncError = '';
let accountDetailsReady = false;
let gcashDetailsLoaded = false;

document.addEventListener('DOMContentLoaded', () => {
    loadProducts();
    loadAccountDetails();
    wireModals();
    wireLogoutConfirmation();
});

function wireLogoutConfirmation() {
    const logoutTrigger = document.getElementById('logoutTrigger');
    const logoutModal = document.getElementById('logoutModal');
    const cancelLogout = document.getElementById('cancelLogout');

    if (!logoutTrigger || !logoutModal) return;

    const closeLogoutModal = () => logoutModal.classList.remove('open');

    logoutTrigger.addEventListener('click', () => logoutModal.classList.add('open'));
    cancelLogout?.addEventListener('click', closeLogoutModal);
    logoutModal.addEventListener('click', (event) => {
        if (event.target === logoutModal) closeLogoutModal();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && logoutModal.classList.contains('open')) closeLogoutModal();
    });
}

async function loadAccountDetails() {
    const address = document.getElementById('deliveryAddress');
    const phone = document.getElementById('contactPhone');
    const message = document.getElementById('checkoutAccountMessage');

    try {
        const response = await rsmApi('customer_account.php');
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(response.status === 401 ? 'Please log in to use your saved delivery details.' : (data.message || 'Could not load account details.'));
        }

        address.value = data.account.address || '';
        phone.value = data.account.phone || '';
        if (!String(data.account.branch || '').trim()) {
            throw new Error('Choose your branch in Account before ordering.');
        }
        if (!address.value.trim()) {
            throw new Error('Add a delivery address in Account before checkout.');
        }
        if (!/^[0-9]{11}$/.test(phone.value.trim())) {
            throw new Error('Add a valid contact number in Account before checkout.');
        }
        accountDetailsReady = true;
        message.textContent = '';
        message.className = 'form-message';
    } catch (error) {
        accountDetailsReady = false;
        message.textContent = error.message || 'Could not load account details.';
        message.className = 'form-message error';
    }

    renderCart();
}

async function loadProducts() {
    const grid = document.getElementById('productGrid');
    try {
        const res = await rsmApi('get_products.php');
        const data = await res.json();

        if (!data.success) {
            grid.innerHTML = `<div class="error-state">${data.message || 'Could not load products.'}</div>`;
            return;
        }

        PRODUCTS = data.products;
        await loadSavedCart();
        buildCategoryChips(PRODUCTS);
        renderGrid(PRODUCTS);
        renderCart();
    } catch (err) {
        grid.innerHTML = `<div class="error-state">Could not reach the server. Please try again.</div>`;
    }
}

function buildCategoryChips(products) {
    const chipsBox = document.getElementById('categoryChips');
    const cats = [...new Set(
        products
            .map(p => p.category_name)
            .filter(cat => cat && cat.toLowerCase() !== 'general')
    )];

    cats.forEach(cat => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = cat;
        btn.dataset.cat = cat;
        chipsBox.appendChild(btn);
    });

    chipsBox.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        chipsBox.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const cat = btn.dataset.cat;
        const filtered = PRODUCTS.filter(p => p.category_name === cat);
        renderGrid(filtered);
    });
}

function renderGrid(products) {
    const grid = document.getElementById('productGrid');

    if (products.length === 0) {
        grid.innerHTML = `<div class="loading-state">No products available right now.</div>`;
        return;
    }

    grid.innerHTML = products.map(p => {
        const stockQty = Number(p.stock_qty) || 0;
        const inStock = stockQty > 0;
        const lowStock = inStock && stockQty <= 5;
        const stockLabel = !inStock ? 'Out of stock' : (lowStock ? `Only ${p.stock_qty} left` : `${p.stock_qty} in stock`);
        const stockClass = !inStock ? 'out' : (lowStock ? 'low' : '');
        const qtyInCart = CART[p.product_id] ? CART[p.product_id].quantity : 0;
        const remainingStock = Math.max(0, stockQty - qtyInCart);

        return `
        <div class="product-card" data-id="${p.product_id}">
            <div class="product-thumb">
                ${p.category_name && p.category_name.toLowerCase() !== 'general'
                    ? `<span class="thumb-badge">${escapeHtml(p.category_name)}</span>`
                    : ''}
                <span class="thumb-icon">🛒</span>
            </div>
            <div class="product-body">
                <span class="p-name">${escapeHtml(p.product_name)}</span>
                <span class="p-desc">${escapeHtml(p.description || '')}</span>
                <div class="p-price-row">
                    <span class="p-price">${money(p.price)}</span>
                    <span class="p-stock ${stockClass}">${stockLabel}</span>
                </div>
                <div class="qty-row">
                    <button type="button" class="qty-minus" disabled>−</button>
                    <input class="qty-val" type="number" min="0" max="${remainingStock}" step="1" value="0" aria-label="Quantity for ${escapeHtml(p.product_name)}" ${!inStock ? 'disabled' : ''}>
                    <button type="button" class="qty-plus" ${remainingStock === 0 ? 'disabled' : ''}>+</button>
                </div>
                <button type="button" class="add-btn" disabled>
                    ${!inStock ? 'Unavailable' : 'Add to Cart'}
                </button>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.product-card').forEach(card => {
        const id = Number(card.dataset.id);
        const product = PRODUCTS.find(p => Number(p.product_id) === id);
        const qtyVal = card.querySelector('.qty-val');
        const minus = card.querySelector('.qty-minus');
        const plus = card.querySelector('.qty-plus');
        const addBtn = card.querySelector('.add-btn');

        let draftQty = 0;
        updateQuantityControls(card);

        qtyVal.addEventListener('input', () => {
            draftQty = qtyVal.value === '' ? 0 : Number(qtyVal.value);
            updateQuantityControls(card);
        });
        qtyVal.addEventListener('change', () => {
            if (qtyVal.value === '') qtyVal.value = '0';
            draftQty = Number(qtyVal.value);
            updateQuantityControls(card);
        });

        plus.addEventListener('click', () => {
            const inCart = CART[product.product_id] ? CART[product.product_id].quantity : 0;
            draftQty = Math.min(Math.max(0, Number(product.stock_qty) - inCart), draftQty + 1);
            qtyVal.value = draftQty;
            updateQuantityControls(card);
        });
        minus.addEventListener('click', () => {
            draftQty = Math.max(0, draftQty - 1);
            qtyVal.value = draftQty;
            updateQuantityControls(card);
        });

        addBtn.addEventListener('click', () => {
            if (Number(product.stock_qty) <= 0) return;
            draftQty = Number(qtyVal.value);
            if (draftQty <= 0 || !qtyVal.reportValidity() || !Number.isInteger(draftQty)) return;
            addToCart(product, draftQty);
            qtyVal.value = '0';
            draftQty = 0;
            updateQuantityControls(card);
        });
    });
}

function updateQuantityControls(card) {
    const productId = Number(card.dataset.id);
    const product = PRODUCTS.find(p => Number(p.product_id) === productId);
    if (!product) return;

    const qtyVal = card.querySelector('.qty-val');
    const minus = card.querySelector('.qty-minus');
    const plus = card.querySelector('.qty-plus');
    const addBtn = card.querySelector('.add-btn');
    const inCart = CART[product.product_id] ? CART[product.product_id].quantity : 0;
    const remainingStock = Math.max(0, Number(product.stock_qty) - inCart);
    const draftQty = qtyVal.value === '' ? 0 : Number(qtyVal.value);

    qtyVal.max = String(remainingStock);
    minus.disabled = draftQty <= 0;
    plus.disabled = remainingStock === 0 || draftQty >= remainingStock;
    addBtn.disabled = remainingStock === 0
        || draftQty <= 0
        || !Number.isInteger(draftQty)
        || draftQty > remainingStock;
}

function addToCart(product, qty) {
    const currentQty = CART[product.product_id] ? CART[product.product_id].quantity : 0;
    const newQty = currentQty + qty;
    if (qty <= 0 || newQty > Number(product.stock_qty)) return;

    CART[product.product_id] = { product, quantity: newQty };
    renderCart();
    persistCart();
}

function syncCartQuantity(product, qty) {
    if (CART[product.product_id]) {
        if (qty === 0) {
            delete CART[product.product_id];
        } else {
            CART[product.product_id].quantity = qty;
        }
        renderCart();
        persistCart();
    }
}

function removeFromCart(id) {
    delete CART[id];
    renderCart();
    persistCart();
}

async function loadSavedCart() {
    try {
        const response = await rsmApi('cart.php');
        const data = await response.json();
        if (!response.ok || !data.success) {
            cartSyncError = response.status === 401
                ? 'Sign in to save your cart across devices.'
                : (data.message || 'Your cart could not be loaded from the server.');
            return;
        }

        CART = {};
        data.items.forEach(item => {
            const product = PRODUCTS.find(p => Number(p.product_id) === Number(item.product_id));
            const quantity = Number(item.quantity);
            if (product && quantity > 0 && quantity <= Number(product.stock_qty)) {
                CART[product.product_id] = { product, quantity };
            }
        });
        cartSyncError = '';
    } catch (error) {
        cartSyncError = 'Your cart could not be loaded from the server.';
    }
}

function persistCart() {
    const items = Object.values(CART).map(item => ({
        product_id: item.product.product_id,
        quantity: item.quantity,
    }));
    cartSaveQueue = cartSaveQueue.then(async () => {
        const response = await rsmApi('cart.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Cart could not be saved.');
        }
        cartSyncError = '';
        renderCart();
    }).catch(error => {
        cartSyncError = error.message === 'Please log in to save your cart.'
            ? 'Sign in to save your cart across devices.'
            : 'Your cart could not be saved. Check your connection and try again.';
        renderCart();
    });
}

function cartTotals() {
    const items = Object.values(CART);
    const total = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
    const count = items.reduce((sum, i) => sum + i.quantity, 0);
    return { total, count, items };
}

function renderCart() {
    const { total, count, items } = cartTotals();
    document.querySelectorAll('.product-card').forEach(updateQuantityControls);

    const drawerBox = document.getElementById('cartItemsDrawer');
    const html = items.length === 0
        ? '<p class="cart-empty">Your cart is empty.</p>'
        : items.map(i => `
            <div class="cart-item">
                <div>
                    <div class="ci-name">${escapeHtml(i.product.product_name)}</div>
                    <div class="ci-sub">${i.quantity} × ${money(i.product.price)}</div>
                </div>
                <div style="text-align:right">
                    <div class="ci-sub">${money(i.product.price * i.quantity)}</div>
                    <button type="button" class="ci-remove" data-remove="${i.product.product_id}">Remove</button>
                </div>
                </div>`).join('');
            const cartHtml = html + (cartSyncError ? `<p class="cart-sync-warning">${escapeHtml(cartSyncError)}</p>` : '');

            if (drawerBox) drawerBox.innerHTML = cartHtml;

    if (drawerBox) {
        drawerBox.querySelectorAll('[data-remove]').forEach(btn => {
            btn.addEventListener('click', () => removeFromCart(Number(btn.dataset.remove)));
        });
    }

    const drawerSubtotal = document.getElementById('drawerSubtotal');
    const drawerTotal = document.getElementById('drawerTotal');
    const cartCount = document.getElementById('cartCount');
    const desktopCartButton = document.getElementById('desktopNavCart');
    const navCartCount = document.getElementById('navCartCount');
    const mobileCartLabel = document.getElementById('mobileCartLabel');
    const mobileCartTotal = document.getElementById('mobileCartTotal');

    if (drawerSubtotal) drawerSubtotal.textContent = money(total);
    if (drawerTotal) drawerTotal.textContent = money(total);
    if (cartCount) cartCount.textContent = count > 0 ? count : '';
    if (desktopCartButton) desktopCartButton.setAttribute('aria-label', `Cart, ${count} item${count === 1 ? '' : 's'}`);
    if (navCartCount) navCartCount.textContent = count > 0 ? count : '';
    if (mobileCartLabel) mobileCartLabel.textContent = `${count} item${count === 1 ? '' : 's'}`;
    if (mobileCartTotal) mobileCartTotal.textContent = money(total);

    const drawerCheckoutBtn = document.getElementById('drawerCheckoutBtn');
    if (drawerCheckoutBtn) drawerCheckoutBtn.disabled = count === 0 || !accountDetailsReady;

}

function wireModals() {
    const cartModal = document.getElementById('cartModal');
    const checkoutModal = document.getElementById('checkoutModal');
    const drawerCheckoutBtn = document.getElementById('drawerCheckoutBtn');

    const openCart = () => cartModal.classList.add('open');
    document.getElementById('mobileCartBar').addEventListener('click', openCart);
    
    // Desktop sidebar and mobile bottom navigation cart buttons
    [
        document.getElementById('desktopNavCart'),
        document.getElementById('mobileNavCart'),
    ].forEach(button => {
        if (button) button.addEventListener('click', event => {
            event.preventDefault();
            openCart();
        });
    });
    
    document.getElementById('closeCartDrawer').addEventListener('click', () => cartModal.classList.remove('open'));

    // The cart drawer is shared by desktop and mobile.
    if (drawerCheckoutBtn) {
        drawerCheckoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            cartModal.classList.remove('open');
            checkoutModal.classList.add('open');
        });
    }
    
    document.getElementById('cancelCheckout').addEventListener('click', () => checkoutModal.classList.remove('open'));

    [cartModal, checkoutModal].forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('open');
        });
    });

    // Hide the bottom nav while a cart or checkout modal is open.
    const bottomNav = document.querySelector('.bottom-nav');
    if (bottomNav) {
        const syncBottomNav = () => {
            const anyOpen = [cartModal, checkoutModal].some(overlay => overlay.classList.contains('open'));
            bottomNav.style.display = anyOpen ? 'none' : '';
        };
        const observer = new MutationObserver(syncBottomNav);
        [cartModal, checkoutModal].forEach(overlay => {
            observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
        });
    }

    document.getElementById('checkoutForm').addEventListener('submit', submitOrder);
    const paymentMethod = document.getElementById('paymentMethod');
    paymentMethod.addEventListener('change', () => {
        const isGcash = paymentMethod.value === 'gcash';
        document.getElementById('gcashPaymentFields').hidden = !isGcash;
        document.getElementById('gcashReference').required = isGcash;
        document.getElementById('gcashProof').required = isGcash;
        if (isGcash) loadGcashPaymentDetails();
    });

    document.getElementById('copyGcashNumber').addEventListener('click', async () => {
        const number = document.getElementById('gcashPaymentNumber').textContent;
        const message = document.getElementById('gcashDetailsMessage');
        try {
            await navigator.clipboard.writeText(number);
            message.textContent = 'GCash number copied.';
            message.className = 'form-message success';
        } catch (error) {
            message.textContent = 'Copy is unavailable here. Select the number to copy it manually.';
            message.className = 'form-message error';
        }
    });
}

async function loadGcashPaymentDetails() {
    const info = document.getElementById('gcashPaymentInfo');
    const message = document.getElementById('gcashDetailsMessage');
    const qrContainer = document.getElementById('gcashQrContainer');
    const numberContainer = document.getElementById('gcashNumberContainer');
    info.hidden = false;
    if (gcashDetailsLoaded) return;
    message.textContent = 'Loading GCash details...';
    message.className = 'form-message';
    try {
        const response = await rsmApi('gcash_settings.php');
        const settings = await response.json();
        if (!response.ok || !settings.success) {
            throw new Error(settings.message || 'Could not load GCash details.');
        }
        gcashDetailsLoaded = true;
        if (settings.qr_url) {
            document.getElementById('gcashPaymentQr').src = settings.qr_url;
            qrContainer.hidden = false;
        }
        if (settings.mobile_number) {
            document.getElementById('gcashPaymentNumber').textContent = settings.mobile_number;
            numberContainer.hidden = false;
        }
        if (!settings.qr_url && !settings.mobile_number) {
            message.textContent = 'GCash payment details are not available right now. Please choose another payment method.';
            message.className = 'form-message error';
            return;
        }
        message.textContent = 'Pay using the QR code or mobile number below, then upload your receipt.';
    } catch (error) {
        message.textContent = error.message || 'Could not load GCash details.';
        message.className = 'form-message error';
    }
}

async function submitOrder(e) {
    e.preventDefault();
    const msg = document.getElementById('checkoutMessage');
    const btn = document.getElementById('placeOrderBtn');
    const checkoutForm = e.currentTarget;
    const { items, count } = cartTotals();

    if (!accountDetailsReady) {
        const accountMessage = document.getElementById('checkoutAccountMessage');
        msg.textContent = accountMessage.textContent
            || 'Add a branch and delivery address in Account before checkout.';
        msg.className = 'form-message error';
        return;
    }

    if (count === 0) {
        msg.textContent = 'Your cart is empty.';
        msg.className = 'form-message error';
        return;
    }

    const cartPayload = items.map(i => ({ product_id: i.product.product_id, quantity: i.quantity }));

    const form = new FormData();
    form.append('cart', JSON.stringify(cartPayload));
    form.append('payment_method', checkoutForm.elements.payment_method.value.trim().toLowerCase());
    if (checkoutForm.elements.payment_method.value === 'gcash') {
        form.append('gcash_reference', checkoutForm.elements.gcash_reference.value.trim());
        if (checkoutForm.elements.gcash_proof.files[0]) {
            form.append('gcash_proof', checkoutForm.elements.gcash_proof.files[0]);
        }
    }

    btn.disabled = true;
    msg.textContent = '';

    try {
        await cartSaveQueue;
        const res = await rsmApi('place_order.php', { method: 'POST', body: form });
        const data = await res.json();

        if (data.success) {
            msg.textContent = data.message;
            msg.className = 'form-message success';
            CART = {};
            renderCart();
            setTimeout(() => { window.location.href = data.redirect; }, 500);
        } else {
            msg.textContent = data.message || 'Could not place order.';
            msg.className = 'form-message error';
            btn.disabled = false;
        }
    } catch (err) {
        msg.textContent = 'Could not reach the server. Please try again.';
        msg.className = 'form-message error';
        btn.disabled = false;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}
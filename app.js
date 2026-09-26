/* ============================================
   RNS Dryfruits — App Logic (Supabase Edition)
   ============================================ */

// ── Supabase Configuration ──
// Uses window.SUPABASE_CONFIG from config.js if available, or falls back to project keys for Vercel/production
const SUPABASE_CONFIG = window.SUPABASE_CONFIG || {
  url: 'https://lvzmkbgduelpngjnsgdu.supabase.co',
  anonKey: 'sb_publishable_oi31ZqkSDau8ace9TZM8uA_NzDzsv5z',
};

const SUPABASE_URL = SUPABASE_CONFIG.url || 'https://lvzmkbgduelpngjnsgdu.supabase.co';
const SUPABASE_ANON_KEY = SUPABASE_CONFIG.anonKey || 'sb_publishable_oi31ZqkSDau8ace9TZM8uA_NzDzsv5z';

if (!window.supabase) {
  console.error('Supabase SDK failed to load. Check your network connection.');
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: 'rns-dryfruits-auth',
  },
});

// ── Product Data ──
const PRODUCTS = [
  {
    id: 1,
    name: 'Plain Whole Cashews',
    category: 'cashew',
    weight: '1kg',
    weightKg: 1,
    price: 900,
    originalPrice: null,
    rating: 4.9,
    reviews: 342,
    badge: null,
    image: 'images/cashew_hero.jpg',
    description: 'Pure whole cashew nuts — nothing added, nothing taken away. Just clean, natural, premium-grade cashews.',
  },
];

// ── State ──
let cart = [];
let showcaseQty = 1;
let isLoggedIn = false;
let currentUser = null;
let otpCooldownTimer = null;

// ── Shipping / Logistics State (ShipGlobal) ──
let shippingQuote = null;       // Latest rate quote response
let selectedShippingService = null; // Selected service object from quote
let shippingQuoteTimer = null;  // Debounce timer for quote refresh

// ── Input Validation / Sanitization Helpers ──
const VALIDATORS = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254,
  name: (v) => /^[A-Za-z\s\.\-']{2,100}$/.test(v),
  phone: (v) => /^[0-9+\-\s\(\)]{7,15}$/.test(v.trim()),
  otp: (v) => /^[0-9]{6}$/.test(v),
};

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeText(str, max = 500) {
  if (str == null) return '';
  return String(str).trim().slice(0, max);
}

// ── Initialization ──
document.addEventListener('DOMContentLoaded', async () => {
  initScrollAnimations();
  initNavbarScroll();
  initSmoothScroll();
  initAuthListener();

  // Restore session on page load, then always sync the auth UI so the
  // account button is wired up even when there is no active session.
  await restoreSession();
  updateAuthUI();

  // If on orders page, render orders after auth is ready
  if (document.getElementById('orders-page') || document.getElementById('orders-list')) {
    // Wait a tick for auth state to settle
    setTimeout(() => renderOrders(), 0);
  }
});

// ── Auth: Session restoration & listener ──
async function restoreSession() {
  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (session?.user) {
      await loadCurrentUser(session.user.id);
    }
  } catch (err) {
    console.error('Session restore failed:', err);
    // If refresh token is invalid, sign out cleanly
    await supabaseClient.auth.signOut();
  }
}

function initAuthListener() {
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      closeAuth();
      await loadCurrentUser(session.user.id);
    } else if (event === 'SIGNED_OUT') {
      isLoggedIn = false;
      currentUser = null;
      updateAuthUI();
    }
  });
}

async function loadCurrentUser(userId) {
  try {
    const { data, error } = await supabaseClient
      .from('customers')
      .select('id, name, email, phone')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      currentUser = data;
      isLoggedIn = true;
      updateAuthUI();
      await renderOrders();
    } else {
      // Auth user exists but profile row missing — happens on first OTP login
      // (existing user from before phone was collected). Try to populate from metadata.
      const { data: { user } } = await supabaseClient.auth.getUser();
      const meta = user?.user_metadata || {};
      const customerRow = {
        id: userId,
        email: user.email,
        name: sanitizeText(meta.name || user.email.split('@')[0], 100),
      };
      // Only include phone if it's a real, non-empty value — omitting it lets
      // the DB column default / NULL constraint apply, avoiding a CHECK
      // violation (e.g. customers_phone_check) when no phone is provided.
      const phoneVal = sanitizeText(meta.phone, 15);
      if (phoneVal) customerRow.phone = phoneVal;

      const { error: insertErr } = await supabaseClient
        .from('customers')
        .insert(customerRow);
      if (insertErr && insertErr.code !== '23505') throw insertErr;
      await loadCurrentUser(userId);
    }
  } catch (err) {
    console.error('loadCurrentUser error:', err);
    showToast('Failed to load profile. Please try again.', 'error');
  }
}

// ── Star rating helper (still used in testimonials if ever needed) ──
function renderStars(rating) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  let stars = '';
  for (let i = 0; i < full; i++) stars += '★';
  if (half) stars += '½';
  for (let i = full + (half ? 1 : 0); i < 5; i++) stars += '☆';
  return stars;
}

// ── Showcase quantity controls ──
function changeShowcaseQty(delta) {
  showcaseQty = Math.max(1, Math.min(99, showcaseQty + delta));
  const el = document.getElementById('showcase-qty');
  if (el) el.textContent = String(showcaseQty);
}

async function addShowcaseToCart() {
  if (!(await requireAuth())) {
    return;
  }

  const product = PRODUCTS[0];
  if (!product) return;
  const existing = cart.find(item => item.id === product.id);
  const addQty = showcaseQty;
  if (existing) {
    existing.qty = Math.min(99, existing.qty + addQty);
  } else {
    cart.push({ ...product, qty: addQty });
  }
  showcaseQty = 1;
  const el = document.getElementById('showcase-qty');
  if (el) el.textContent = '1';
  updateCartUI();
  showToast(`${product.name} × ${addQty} added to cart!`, 'success');
  // Mini animation feedback
  const btn = document.querySelector('.showcase-add-btn');
  if (btn) {
    const original = btn.innerHTML;
    btn.innerHTML = '✓ Added';
    setTimeout(() => { btn.innerHTML = original; }, 1200);
  }
}

// ── Cart Functions ──

// Verify the user is logged in before performing cart actions that require
// an account (e.g. adding items that will become an order).
// Returns true if the user is authenticated; false if they were redirected
// to the auth modal.
async function requireAuth() {
  if (isLoggedIn && currentUser) {
    return true;
  }

  // Verify the session is actually valid against Supabase (not just stale state)
  try {
    const { data: { user }, error } = await supabaseClient.auth.getUser();
    if (error) {
      console.warn('[Auth check] getUser error (continuing to login):', error);
    }
    if (user) {
      // Session is valid but local state wasn't synced — reload the profile
      await loadCurrentUser(user.id);
      if (isLoggedIn && currentUser) {
        return true;
      }
    }
  } catch (err) {
    console.warn('[Auth check] verification exception:', err);
  }

  // Not authenticated → redirect to auth modal
  openAuth();
  showToast('Please sign in to add items to your cart', 'info');
  return false;
}

async function addToCart(productId) {
  if (!(await requireAuth())) {
    return;
  }

  const id = Number(productId);
  const product = PRODUCTS.find(p => p.id === id);
  if (!product) return;

  const existing = cart.find(item => item.id === id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...product, qty: 1 });
  }

  // Sync the showcase quantity display if present
  const showcaseQtyEl = document.getElementById('showcase-qty');
  if (showcaseQtyEl) showcaseQtyEl.textContent = String(existing ? existing.qty : 1);

  updateCartUI();
  showToast(`${product.name} added to cart!`, 'success');

  const btn = document.getElementById(`atc-btn-${id}`);
  if (btn) {
    btn.classList.add('added');
    btn.innerHTML = '<span>✓</span> Added';
    setTimeout(() => {
      btn.classList.remove('added');
      btn.innerHTML = '<span>+</span> Add';
    }, 1500);
  }
}

function removeFromCart(productId) {
  const id = Number(productId);
  cart = cart.filter(item => item.id !== id);
  updateCartUI();
  renderCartItems();
}

function updateQty(productId, delta) {
  const id = Number(productId);
  const item = cart.find(i => i.id === id);
  if (!item) return;

  item.qty += delta;
  if (item.qty <= 0) {
    removeFromCart(id);
    return;
  }
  if (item.qty > 99) item.qty = 99;

  updateCartUI();
  renderCartItems();
}

function updateCartUI() {
  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  const badge = document.getElementById('cart-badge');
  badge.textContent = totalItems;
  badge.classList.toggle('visible', totalItems > 0);

  document.getElementById('cart-count-label').textContent = `(${totalItems})`;

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  document.getElementById('cart-subtotal').textContent = `₹${subtotal.toLocaleString('en-IN')}`;
  document.getElementById('cart-total').textContent = `₹${subtotal.toLocaleString('en-IN')}`;

  // Shipping quote display
  const shippingEl = document.getElementById('cart-shipping');
  if (shippingEl) {
    if (selectedShippingService && shippingQuote) {
      const shippingCost = Number(selectedShippingService.subtotal_fee || selectedShippingService.price?.logistic_fee || 0);
      shippingEl.textContent = `${shippingQuote.currency || 'INR'} ${shippingCost.toLocaleString('en-IN')}`;
      document.getElementById('cart-total').textContent = `${shippingQuote.currency || 'INR'} ${(subtotal + shippingCost).toLocaleString('en-IN')}`;
    } else if (shippingQuote) {
      shippingEl.textContent = 'Select a service';
    } else {
      shippingEl.textContent = 'Not calculated';
    }
  }

  const isEmpty = cart.length === 0;
  document.getElementById('cart-empty').style.display = isEmpty ? 'flex' : 'none';
  document.getElementById('cart-footer').style.display = isEmpty ? 'none' : 'block';
  document.getElementById('shipping-quote').style.display = isEmpty ? 'none' : 'block';
}

function renderCartItems() {
  const container = document.getElementById('cart-items');
  const emptyEl = document.getElementById('cart-empty');

  container.querySelectorAll('.cart-item').forEach(el => el.remove());

  cart.forEach(item => {
    const el = document.createElement('div');
    el.className = 'cart-item';
    el.innerHTML = `
      <div class="cart-item-img">
        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" />
      </div>
      <div class="cart-item-info">
        <div class="cart-item-title">${escapeHtml(item.name)}</div>
        <div class="cart-item-variant">${escapeHtml(item.weight)}</div>
        <div class="cart-item-controls">
          <div class="qty-control">
            <button class="qty-btn" onclick="updateQty(${Number(item.id)}, -1)" aria-label="Decrease quantity">−</button>
            <span class="qty-value">${Number(item.qty)}</span>
            <button class="qty-btn" onclick="updateQty(${Number(item.id)}, 1)" aria-label="Increase quantity">+</button>
          </div>
          <span class="cart-item-price">₹${(Number(item.price) * Number(item.qty)).toLocaleString('en-IN')}</span>
          <button class="cart-item-remove" onclick="removeFromCart(${Number(item.id)})" aria-label="Remove item">🗑</button>
        </div>
      </div>
    `;
    container.insertBefore(el, emptyEl);
  });
}

function openCart() {
  document.getElementById('cart-overlay').classList.add('open');
  document.getElementById('cart-sidebar').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderCartItems();
}

function closeCart() {
  document.getElementById('cart-overlay').classList.remove('open');
  document.getElementById('cart-sidebar').classList.remove('open');
  document.body.style.overflow = '';
}

// ── Shipping: Get live quote from ShipGlobal ──
async function getShippingQuote() {
  if (!(await requireAuth())) {
    return;
  }

  const countryEl = document.getElementById('shipping-country');
  const postcodeEl = document.getElementById('shipping-postcode');
  const noteEl = document.getElementById('shipping-note');
  const optionsEl = document.getElementById('shipping-options');
  const btn = document.getElementById('get-quote-btn');

  const country = countryEl.value;
  const postcode = sanitizeText(postcodeEl.value, 20);

  if (!country) {
    noteEl.textContent = 'Please select a destination country.';
    noteEl.style.display = 'block';
    return;
  }
  if (!postcode) {
    noteEl.textContent = 'Please enter a postal code.';
    noteEl.style.display = 'block';
    return;
  }

  const totalWeightKg = cart.reduce((sum, item) => sum + (Number(item.weightKg) || 1) * Number(item.qty), 0);
  if (totalWeightKg <= 0) {
    noteEl.textContent = 'Could not calculate package weight. Please try again.';
    noteEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span> Getting quote…';
  noteEl.style.display = 'none';
  optionsEl.style.display = 'none';

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated');

    const response = await fetch(`${SUPABASE_URL}/functions/v1/get-shipping-rates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        package_weight: totalWeightKg,
        country_iso_code_2: country,
        postcode,
      }),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Could not get shipping quote');
    }

    shippingQuote = result;
    selectedShippingService = null;
    renderShippingOptions(result);
    showToast('Shipping quote received!', 'success');
  } catch (err) {
    console.error('getShippingQuote error:', err);
    noteEl.textContent = err.message || 'Could not get shipping quote. Please try again.';
    noteEl.style.display = 'block';
    showToast(noteEl.textContent, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Get Shipping Quote';
    }
  }
}

function renderShippingOptions(quote) {
  const optionsEl = document.getElementById('shipping-options');
  if (!optionsEl) return;

  const services = quote.services || [];
  if (!services.length) {
    optionsEl.innerHTML = '<p style="font-size: var(--fs-xs); color: var(--clr-text-secondary);">No shipping services available for this destination.</p>';
    optionsEl.style.display = 'block';
    return;
  }

  optionsEl.innerHTML = services.map((service, index) => `
    <label class="shipping-option ${index === 0 ? 'selected' : ''}">
      <input type="radio" name="shipping-service" value="${index}" ${index === 0 ? 'checked' : ''} />
      <div class="shipping-option-info">
        <div class="shipping-option-title">${escapeHtml(service.title)}</div>
        <div class="shipping-option-meta">
          ${escapeHtml(service.transit_time || 'Transit time not specified')}
          ${service.notes ? `<br />${escapeHtml(service.notes)}` : ''}
        </div>
      </div>
      <div class="shipping-option-price">
        <strong>${quote.currency || 'INR'} ${Number(service.subtotal_fee || service.price?.logistic_fee || 0).toLocaleString('en-IN')}</strong>
        <span>DDP</span>
      </div>
    </label>
  `).join('');

  optionsEl.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const index = Number(radio.value);
      selectedShippingService = services[index];
      optionsEl.querySelectorAll('.shipping-option').forEach(opt => opt.classList.remove('selected'));
      radio.closest('.shipping-option').classList.add('selected');
      updateCartUI();
    });
  });

  // Default to first service
  selectedShippingService = services[0];
  optionsEl.style.display = 'flex';

  const addressForm = document.getElementById('shipping-address-form');
  if (addressForm) {
    addressForm.style.display = 'block';
    if (currentUser) {
      const parts = (currentUser.name || '').trim().split(' ');
      const firstNameInput = document.getElementById('shipping-first-name');
      const lastNameInput = document.getElementById('shipping-last-name');
      const phoneInput = document.getElementById('shipping-phone');
      if (firstNameInput && !firstNameInput.value) firstNameInput.value = parts[0] || '';
      if (lastNameInput && !lastNameInput.value) lastNameInput.value = parts.slice(1).join(' ') || parts[0] || '';
      if (phoneInput && !phoneInput.value && currentUser.phone) phoneInput.value = currentUser.phone;
    }
  }

  updateCartUI();
}

// ── Shipping: helper to compute package dimensions from cart ──
function getPackageDetails() {
  const totalWeightKg = cart.reduce((sum, item) => sum + (Number(item.weightKg) || 1) * Number(item.qty), 0);
  return {
    weight: totalWeightKg,
    length: 30,
    breadth: 30,
    height: 30,
  };
}

// ── Checkout: insert order into DB ──
async function handleCheckout() {
  // Verify session against Supabase before proceeding
  if (!(await requireAuth())) {
    closeCart();
    return;
  }

  if (cart.length === 0) {
    showToast('Your cart is empty', 'error');
    return;
  }

  const shippingCountry = document.getElementById('shipping-country')?.value || '';
  const shippingPostcode = sanitizeText(document.getElementById('shipping-postcode')?.value, 20) || '';
  const firstName = sanitizeText(document.getElementById('shipping-first-name')?.value, 100);
  const lastName = sanitizeText(document.getElementById('shipping-last-name')?.value, 100);
  const address = sanitizeText(document.getElementById('shipping-address')?.value, 200);
  const address2 = sanitizeText(document.getElementById('shipping-address2')?.value, 200);
  const city = sanitizeText(document.getElementById('shipping-city')?.value, 100);
  const state = sanitizeText(document.getElementById('shipping-state')?.value, 100);
  const phone = sanitizeText(document.getElementById('shipping-phone')?.value, 30);

  // If shipping service is selected, require delivery address
  if (selectedShippingService && shippingQuote) {
    if (!shippingCountry) {
      showToast('Please select a destination country', 'error');
      document.getElementById('shipping-country')?.focus();
      return;
    }
    if (!shippingPostcode) {
      showToast('Please enter a destination postal code', 'error');
      document.getElementById('shipping-postcode')?.focus();
      return;
    }
    if (!firstName || !lastName) {
      showToast('Please enter recipient first and last name', 'error');
      document.getElementById('shipping-first-name')?.focus();
      return;
    }
    if (!address) {
      showToast('Please enter street address for delivery', 'error');
      document.getElementById('shipping-address')?.focus();
      return;
    }
    if (!city) {
      showToast('Please enter delivery city', 'error');
      document.getElementById('shipping-city')?.focus();
      return;
    }
    if (!state) {
      showToast('Please enter delivery state / province', 'error');
      document.getElementById('shipping-state')?.focus();
      return;
    }
    if (!phone) {
      showToast('Please enter recipient contact phone number', 'error');
      document.getElementById('shipping-phone')?.focus();
      return;
    }
  }

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const shippingCost = selectedShippingService && shippingQuote
    ? Number(selectedShippingService.subtotal_fee || selectedShippingService.price?.logistic_fee || 0)
    : 0;
  const total = subtotal + shippingCost;

  const orderItems = cart.map(item => ({
    id: Number(item.id),
    name: sanitizeText(item.name, 100),
    weight: sanitizeText(item.weight, 50),
    price: Number(item.price),
    qty: Number(item.qty),
    image: sanitizeText(item.image, 200),
  }));

  const submitBtn = document.querySelector('#cart-footer .btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Placing order…';
  }

  try {
    // ── Insert order into Supabase ──
    const { data, error } = await supabaseClient
      .from('orders')
      .insert({
        customer_id: currentUser.id,
        items: orderItems,
        total: total,
        shipping_country: shippingCountry || null,
        shipping_postcode: shippingPostcode || null,
        shipping_service: selectedShippingService?.title || null,
        shipping_cost: shippingCost || null,
        shipping_currency: shippingQuote?.currency || 'INR',
      })
      .select()
      .single();

    if (error) throw error;

    const serverTotal = Number(data.total) || total;

    // ── Create ShipGlobal shipment if a shipping service was selected ──
    let shipmentResult = null;
    if (selectedShippingService && shippingQuote) {
      try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const customer = currentUser;
        const packageInfo = getPackageDetails();

        const response = await fetch(`${SUPABASE_URL}/functions/v1/create-shipment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            orderId: data.id,
            service: selectedShippingService.title,
            currency: shippingQuote.currency || 'USD',
            customer: {
              firstname: firstName || (customer.name || customer.email).split(' ')[0] || customer.email.split('@')[0],
              lastname: lastName || (customer.name || customer.email).split(' ').slice(1).join(' ') || customer.email.split('@')[0],
              mobile: phone || customer.phone || '',
              email: customer.email,
              company: '',
              address: address,
              address2: address2 || '',
              address3: '',
              city: city,
              postcode: shippingPostcode,
              country: shippingCountry,
              state: state,
            },
            package: packageInfo,
            items: orderItems.map(item => ({
              name: item.name,
              quantity: item.qty,
              unit_price: item.price,
              hsn: '0801',
              tax_rate: 0,
              sku: '',
            })),
          }),
        });

        const result = await response.json();
        if (response.ok && result.success) {
          shipmentResult = result;
          showToast(`Shipment created! Tracking: ${result.tracking}`, 'success');
        } else {
          console.warn('[Checkout] Shipment creation failed:', result);
          showToast('Order placed, but shipping label could not be created. We will follow up.', 'info');
        }
      } catch (shipmentErr) {
        console.warn('[Checkout] Shipment creation exception:', shipmentErr);
        showToast('Order placed, but shipping setup needs manual review.', 'info');
      }
    }

    showToast(`Order ${data.id.slice(0, 8).toUpperCase()} placed! Total: ${shippingQuote?.currency || 'INR'} ${serverTotal.toLocaleString('en-IN')}`, 'success');
    cart = [];
    shippingQuote = null;
    selectedShippingService = null;
    const addressFormEl = document.getElementById('shipping-address-form');
    if (addressFormEl) addressFormEl.style.display = 'none';
    updateCartUI();
    renderCartItems();
    closeCart();
    await renderOrders();
    document.getElementById('orders').scrollIntoView({ behavior: 'smooth', block: 'start' });

    // ── Send order confirmation email via Edge Function ──
    // This is a best-effort call — if it fails, the order is still placed.
    try {
      await sendOrderConfirmationEmail(data, currentUser);
    } catch (emailErr) {
      console.warn('Order confirmation email failed (non-critical):', emailErr);
    }
  } catch (err) {
    console.error('Checkout failed:', err);
    showToast(err.message || 'Could not place order. Please try again.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Proceed to Checkout';
    }
  }
}

// ── Auth UI ──
// ── Auth Alerts ──
function showAuthAlert(message, type = 'error') {
  const alertEl = document.getElementById('auth-alert');
  if (!alertEl) return;
  const icons = { error: '⚠️', info: 'ℹ️', success: '✅' };
  alertEl.className = `auth-alert ${type}`;
  alertEl.innerHTML = `<span>${icons[type] || '⚠️'}</span> <div>${escapeHtml(message)}</div>`;
  alertEl.style.display = 'flex';
}

function clearAuthAlert() {
  const alertEl = document.getElementById('auth-alert');
  if (alertEl) {
    alertEl.style.display = 'none';
    alertEl.innerHTML = '';
  }
}

// ── Auth UI ──
function switchAuthTab(tabName, tabEl) {
  // Toggle active state on tab buttons (if present in DOM)
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');

  // Show the corresponding form; this app only has login + OTP forms
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  const targetForm = tabName === 'register' ? document.getElementById('register-form') : document.getElementById('login-form');
  if (targetForm) targetForm.classList.add('active');
}

function toggleAccountDropdown() {
  const menu = document.getElementById('account-dropdown-menu');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  const btn = document.getElementById('account-btn');
  if (btn) btn.setAttribute('aria-expanded', String(!isOpen));
}

function closeAccountDropdown() {
  const menu = document.getElementById('account-dropdown-menu');
  if (menu) menu.style.display = 'none';
  const btn = document.getElementById('account-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function scrollToOrders() {
  const orders = document.getElementById('orders');
  if (orders) orders.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleSignOut() {
  try {
    await supabaseClient.auth.signOut();
    showToast('Signed out successfully', 'info');
  } catch (err) {
    console.error('Sign out failed:', err);
    showToast('Could not sign out. Please try again.', 'error');
  }
}

function openAuth() {
  clearAuthAlert();
  document.getElementById('auth-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  // Ensure login form is shown (safe no-op if tabs absent)
  switchAuthTab('login', document.querySelector('.auth-tab[data-tab="login"]'));
}

function closeAuth() {
  clearAuthAlert();
  document.getElementById('auth-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function showOtpForm(email) {
  clearAuthAlert();
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('otp-form').classList.add('active');
  document.getElementById('otp-email-display').textContent = email;
  document.getElementById('otp-code').value = '';
  // Scroll modal to top in case it scrolled during form filling
  const modal = document.querySelector('.auth-modal');
  if (modal) modal.scrollTop = 0;
  startOtpCooldown(60);
}

function backToAuth(e) {
  e.preventDefault();
  clearAuthAlert();
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('login-form').classList.add('active');
}

let otpSecondsLeft = 0;
function startOtpCooldown(seconds) {
  otpSecondsLeft = seconds;
  const btn = document.getElementById('otp-form')?.querySelector('button[type="submit"]');
  const resendLink = document.querySelector('#otp-form a[onclick*="resendOtp"]');
  if (!resendLink) return;
  const originalText = 'Resend code';
  const tick = () => {
    if (otpSecondsLeft <= 0) {
      resendLink.textContent = originalText;
      resendLink.style.pointerEvents = 'auto';
      resendLink.style.opacity = '1';
      if (otpCooldownTimer) clearInterval(otpCooldownTimer);
      return;
    }
    resendLink.textContent = `Resend code (${otpSecondsLeft}s)`;
    resendLink.style.pointerEvents = 'none';
    resendLink.style.opacity = '0.6';
    otpSecondsLeft--;
  };
  tick();
  if (otpCooldownTimer) clearInterval(otpCooldownTimer);
  otpCooldownTimer = setInterval(tick, 1000);
}

// ── Login (Email OTP - works for both new & existing users) ──
async function handleLogin(e) {
  e.preventDefault();
  clearAuthAlert();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const emailRaw = document.getElementById('login-email').value;
  const email = sanitizeText(emailRaw, 254).toLowerCase();

  if (!VALIDATORS.email(email)) {
    showAuthAlert('Please enter a valid email address.');
    showToast('Please enter a valid email address.', 'error');
    return;
  }

  await requestOtp(email, submitBtn);
}

// ── Send OTP via Supabase ──
async function requestOtp(email, triggerBtn = null) {
  const originalBtnText = triggerBtn ? triggerBtn.innerHTML : null;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = '<span class="btn-spinner"></span> Sending OTP…';
  }

  try {
    const options = {
      shouldCreateUser: true,
    };
    if (window.location.origin && window.location.origin !== 'null' && window.location.protocol.startsWith('http')) {
      options.emailRedirectTo = window.location.origin;
    }

    const { data, error } = await supabaseClient.auth.signInWithOtp({
      email,
      options,
    });

    if (error) {
      console.error('[Supabase signInWithOtp error]', error);
      const msg = (error.message || '').toLowerCase();
      let userMsg = error.message || 'Could not send OTP. Please try again.';
      if (msg.includes('signups not allowed') || msg.includes('signup_disabled')) {
        userMsg = 'New signups are currently disabled in Supabase. Contact support.';
      } else if (msg.includes('rate limit') || msg.includes('over_email_send_rate_limit') || msg.includes('email rate')) {
        userMsg = 'Too many login attempts. Please wait a few minutes and try again, or contact support.';
      }
      showAuthAlert(userMsg, 'error');
      showToast(userMsg, 'error');
      return;
    }

    clearAuthAlert();
    console.log('[Supabase signInWithOtp] OTP request sent to', email);
    showOtpForm(email);
    showToast('Check your email for the 6-digit code.', 'success');
  } catch (err) {
    console.error('[OTP request exception]', err);
    const userMsg = err.message || 'Could not send OTP. Please try again.';
    showAuthAlert(userMsg, 'error');
    showToast(userMsg, 'error');
  } finally {
    if (triggerBtn && originalBtnText) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = originalBtnText;
    }
  }
}

// ── Verify OTP ──
async function handleOtpVerify(e) {
  e.preventDefault();
  clearAuthAlert();
  const codeRaw = document.getElementById('otp-code').value;
  const emailDisplay = document.getElementById('otp-email-display').textContent;
  const code = sanitizeText(codeRaw, 6);

  if (!VALIDATORS.otp(code)) {
    showAuthAlert('Code must be exactly 6 digits.');
    showToast('Code must be exactly 6 digits.', 'error');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="btn-spinner"></span> Verifying…';
  }

  try {
    let result = await supabaseClient.auth.verifyOtp({
      email: emailDisplay,
      token: code,
      type: 'email',
    });

    // Fallback: if 'email' token type fails, try 'signup' in case Supabase treated it as a new signup confirmation
    if (result.error && (result.error.message?.includes('expired') || result.error.message?.includes('invalid'))) {
      const fallbackResult = await supabaseClient.auth.verifyOtp({
        email: emailDisplay,
        token: code,
        type: 'signup',
      });
      if (!fallbackResult.error) {
        result = fallbackResult;
      }
    }

    if (result.error) throw result.error;
    const { data } = result;

    closeAuth();
    showToast('Signed in successfully!', 'success');
    // loadCurrentUser is triggered automatically by onAuthStateChange listener
  } catch (err) {
    console.error('OTP verify failed:', err);
    const userMsg = err.message || 'Invalid or expired code. Please try again.';
    showAuthAlert(userMsg, 'error');
    showToast(userMsg, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Verify & Sign In';
    }
  }
}

async function resendOtp(e) {
  e.preventDefault();
  if (otpSecondsLeft > 0) return;
  const email = document.getElementById('otp-email-display').textContent;
  await requestOtp(email);
}

// ── OAuth (Google) ──
async function handleOAuth(provider) {
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  } catch (err) {
    console.error('OAuth failed:', err);
    showToast(err.message || 'OAuth sign-in failed.', 'error');
  }
}

// ── Auth UI sync ──
function updateAuthUI() {
  const accountBtn = document.getElementById('account-btn');
  // Support both orders.html (orders-page) and legacy index.html (orders-section)
  const ordersSection = document.getElementById('orders-page') || document.getElementById('orders-section') || document.getElementById('orders');
  const ordersLoggedOut = document.getElementById('orders-logged-out');
  const ordersList = document.getElementById('orders-list');
  const dropdownMenu = document.getElementById('account-dropdown-menu');
  const dropdownHeader = document.getElementById('account-dropdown-header');
  const accountName = document.getElementById('account-name');
  const accountEmail = document.getElementById('account-email');
  const accountAvatar = document.getElementById('account-avatar');
  const accountOrdersLink = document.getElementById('account-orders-link');
  const accountSignoutBtn = document.getElementById('account-signout-btn');
  const accountSigninLink = document.getElementById('account-signin-link');

  if (isLoggedIn && currentUser) {
    const initial = (currentUser.name || currentUser.email || '?').charAt(0).toUpperCase();
    accountBtn.innerHTML = `<span style="font-size: 12px; font-weight: 700;">${escapeHtml(initial)}</span>`;
    accountBtn.style.background = 'var(--grad-gold)';
    accountBtn.style.color = 'var(--clr-text-inverse)';
    accountBtn.title = currentUser.email || '';
    accountBtn.onclick = toggleAccountDropdown;
    accountBtn.setAttribute('aria-expanded', 'false');

    if (dropdownHeader) dropdownHeader.style.display = 'flex';
    if (accountAvatar) accountAvatar.textContent = initial;
    if (accountName) accountName.textContent = currentUser.name || currentUser.email.split('@')[0];
    if (accountEmail) accountEmail.textContent = currentUser.email;
    if (accountOrdersLink) accountOrdersLink.style.display = 'flex';
    if (accountSignoutBtn) accountSignoutBtn.style.display = 'flex';
    if (accountSigninLink) accountSigninLink.style.display = 'none';
    if (dropdownMenu) dropdownMenu.style.display = 'none';

    if (ordersSection) ordersSection.classList.add('visible');
    if (ordersLoggedOut) ordersLoggedOut.style.display = 'none';
    if (ordersList) ordersList.style.display = 'flex';
  } else {
    accountBtn.innerHTML = '👤';
    accountBtn.style.background = '';
    accountBtn.style.color = '';
    accountBtn.title = '';
    accountBtn.onclick = openAuth;
    accountBtn.setAttribute('aria-expanded', 'false');

    if (dropdownHeader) dropdownHeader.style.display = 'none';
    if (accountOrdersLink) accountOrdersLink.style.display = 'none';
    if (accountSignoutBtn) accountSignoutBtn.style.display = 'none';
    if (accountSigninLink) accountSigninLink.style.display = 'flex';
    if (dropdownMenu) dropdownMenu.style.display = 'none';

    if (ordersSection) ordersSection.classList.remove('visible');
    if (ordersLoggedOut) ordersLoggedOut.style.display = 'block';
    if (ordersList) ordersList.style.display = 'none';
  }
}

// ── Order Tracking: fetch real orders from DB ──
async function renderOrders() {
  // Support both orders.html (orders-page) and legacy index.html (orders-section)
  const list = document.getElementById('orders-list');
  const loggedOutEl = document.getElementById('orders-logged-out');
  const ordersSection = document.getElementById('orders-section') || document.getElementById('orders-page');

  if (!list) return; // No orders container on this page

  if (!isLoggedIn || !currentUser) {
    list.innerHTML = '';
    if (loggedOutEl) loggedOutEl.style.display = 'block';
    if (ordersSection) ordersSection.classList.remove('visible');
    return;
  }

  if (loggedOutEl) loggedOutEl.style.display = 'none';
  if (ordersSection) ordersSection.classList.add('visible');
  list.style.display = 'flex';

  list.innerHTML = '<div style="text-align:center; color: var(--clr-text-secondary); padding: var(--sp-6);">Loading your orders…</div>';

  try {
    const { data, error } = await supabaseClient
      .from('orders')
      .select('id, items, total, status, progress, created_at, shipping_country, shipping_postcode, shipping_service, shipping_cost, shipping_currency, shipglobal_tracking, shipglobal_service, shipglobal_status, shipglobal_status_code, shipglobal_events, shipglobal_last_synced_at, shipglobal_created, shipglobal_cancelled')
      .eq('customer_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      list.innerHTML = `
        <div style="text-align:center; padding: var(--sp-8); color: var(--clr-text-secondary);">
          <div style="font-size: 3rem; margin-bottom: var(--sp-3);">📦</div>
          <h3 style="margin-bottom: var(--sp-2);">No orders yet</h3>
          <p>Your order history will appear here once you place your first order.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = data.map(order => renderOrderCard(order)).join('');
  } catch (err) {
    console.error('renderOrders error:', err);
    list.innerHTML = `<div style="text-align:center; color: var(--clr-danger, #c0392b); padding: var(--sp-6);">Could not load orders. Please refresh and try again.</div>`;
  }
}

function renderOrderCard(order) {
  const date = new Date(order.created_at);
  const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const progress = Number(order.progress) || 0;
  const status = escapeHtml(order.status || 'processing');
  const total = Number(order.total) || 0;
  const shortId = order.id.slice(0, 8).toUpperCase();
  const tracking = order.shipglobal_tracking || '';
  const shipStatus = escapeHtml(order.shipglobal_status || '');
  const shipService = escapeHtml(order.shipglobal_service || order.shipping_service || '');
  const hasTracking = Boolean(tracking);

  const items = Array.isArray(order.items) ? order.items : [];
  const thumbs = items.map(it => `
    <div class="order-item-thumb" title="${escapeHtml(it.name)}">
      <img src="${escapeHtml(it.image || 'images/cashew_hero.jpg')}" alt="${escapeHtml(it.name)}" onerror="this.src='images/cashew_hero.jpg'" />
    </div>
  `).join('');

  const itemLines = items.map(it => `
    <span style="font-size: var(--fs-xs); color: var(--clr-text-secondary);">${escapeHtml(it.name)} × ${Number(it.qty)}</span>
  `).join('');

  const isCancelled = order.status === 'cancelled' || Boolean(order.shipglobal_cancelled);
  const isDelivered = order.status === 'delivered';

  const trackingBlock = hasTracking ? `
    <div class="order-tracking-info">
      <div class="order-tracking-row">
        <span class="order-tracking-label">ShipGlobal Tracking</span>
        <span class="order-tracking-value">${escapeHtml(tracking)}</span>
      </div>
      ${shipService ? `<div class="order-tracking-row">
        <span class="order-tracking-label">Service</span>
        <span class="order-tracking-value">${shipService}</span>
      </div>` : ''}
      ${shipStatus ? `<div class="order-tracking-row">
        <span class="order-tracking-label">Status</span>
        <span class="order-tracking-value">${shipStatus}</span>
      </div>` : ''}
      ${isCancelled ? `
        <div style="margin-top: var(--sp-2); padding: var(--sp-2); background: rgba(192, 57, 43, 0.08); border-radius: var(--radius-sm); border-left: 3px solid var(--clr-danger, #c0392b);">
          <span style="font-size: var(--fs-xs); color: var(--clr-danger, #c0392b); font-weight: 600;">🚫 Shipment Cancelled / Refund Processed</span>
        </div>
      ` : `
        <div style="display:flex; gap: var(--sp-2); margin-top: var(--sp-2); flex-wrap: wrap;">
          <button class="btn btn-secondary btn-sm" onclick="openTracking('${escapeHtml(tracking)}')">
            🚚 Track Shipment
          </button>
          ${!isDelivered ? `
            <button class="btn btn-secondary btn-sm" style="color: var(--clr-danger, #c0392b); border-color: rgba(192, 57, 43, 0.35);" onclick="cancelOrder('${escapeHtml(tracking)}')">
              🚫 Cancel Shipment
            </button>
          ` : ''}
        </div>
      `}
    </div>
  ` : `
    <div class="order-tracking-info order-tracking-pending">
      <span>Shipping label will be generated after your order is processed.</span>
    </div>
  `;

  return `
    <div class="order-card">
      <div class="order-card-header">
        <span class="order-id">#${escapeHtml(shortId)}</span>
        <span class="order-date">Ordered: ${escapeHtml(dateStr)}</span>
        <span class="order-status ${status}">${status}</span>
      </div>
      <div class="order-card-body">
        <div class="order-items-preview">
          ${thumbs}
          <div style="display:flex; flex-direction:column; justify-content:center; margin-left: var(--sp-2);">
            ${itemLines}
          </div>
        </div>

        <div class="order-timeline">
          <div class="order-timeline-progress" style="width: ${progress}%;"></div>
          <div class="timeline-step ${progress >= 10 ? 'completed' : ''}">
            <div class="timeline-step-dot">✓</div>
            <span class="timeline-step-label">Confirmed</span>
          </div>
          <div class="timeline-step ${progress >= 33 ? 'completed' : ''} ${progress >= 25 && progress < 50 ? 'active' : ''}">
            <div class="timeline-step-dot">${progress >= 33 ? '✓' : ''}</div>
            <span class="timeline-step-label">Processing</span>
          </div>
          <div class="timeline-step ${progress >= 66 ? 'completed' : ''} ${progress >= 50 && progress < 80 ? 'active' : ''}">
            <div class="timeline-step-dot">${progress >= 66 ? '✓' : ''}</div>
            <span class="timeline-step-label">Shipped</span>
          </div>
          <div class="timeline-step ${progress >= 100 ? 'completed' : ''} ${progress >= 80 && progress < 100 ? 'active' : ''}">
            <div class="timeline-step-dot">${progress >= 100 ? '✓' : ''}</div>
            <span class="timeline-step-label">Delivered</span>
          </div>
        </div>

        ${trackingBlock}

        <div class="order-total">
          Order Total: <strong>${escapeHtml(order.shipping_currency || 'INR')} ${total.toLocaleString('en-IN')}</strong>
        </div>
      </div>
    </div>
  `;
}

// ── Tracking Modal ──
function openTracking(tracking) {
  if (!tracking) return;
  const overlay = document.getElementById('tracking-overlay');
  if (overlay) overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  loadTracking(tracking);
}

function closeTracking() {
  const overlay = document.getElementById('tracking-overlay');
  if (overlay) overlay.classList.remove('open');
  if (!document.getElementById('auth-overlay')?.classList.contains('open')) {
    document.body.style.overflow = '';
  }
}

async function loadTracking(tracking) {
  const content = document.getElementById('tracking-content');
  if (!content) return;
  content.innerHTML = '<p style="text-align:center; color: var(--clr-text-secondary);">Loading tracking details…</p>';

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated');

    const response = await fetch(`${SUPABASE_URL}/functions/v1/track-shipment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ tracking }),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Could not load tracking details');
    }

    renderTracking(result.data);
  } catch (err) {
    console.error('loadTracking error:', err);
    content.innerHTML = `
      <div style="text-align:center; padding: var(--sp-6);">
        <p style="color: var(--clr-danger, #c0392b); font-weight: 600;">Could not load tracking details.</p>
        <p style="font-size: var(--fs-xs); color: var(--clr-text-secondary);">${escapeHtml(err.message || 'Please try again later.')}</p>
      </div>
    `;
  }
}

function renderTracking(data) {
  const content = document.getElementById('tracking-content');
  if (!content) return;

  const awbInfo = data.awbInfo || {};
  const events = Array.isArray(data.awbEvents) ? data.awbEvents : [];
  const tracking = awbInfo.awb_number || '';
  const status = escapeHtml(awbInfo.awb_status || data.status || 'Unknown');
  const destination = escapeHtml(awbInfo.awb_destination || '');
  const lastMile = escapeHtml(awbInfo.partner_lastmile_display || '');
  const lastMileUrl = awbInfo.partner_lastmile_tracking_url || '';

  const eventsHtml = events.length ? events.map(event => `
    <div class="tracking-event">
      <div class="tracking-event-time">${escapeHtml(event.awb_history_datetime || '')}</div>
      <div class="tracking-event-title">${escapeHtml(event.awb_history_comment || '')}</div>
      <div class="tracking-event-location">${escapeHtml(event.awb_history_location || '')}${event.type ? ` · ${escapeHtml(event.type)}` : ''}</div>
    </div>
  `).join('') : '<p style="font-size: var(--fs-xs); color: var(--clr-text-secondary);">No tracking events available yet.</p>';

  content.innerHTML = `
    <div class="tracking-summary">
      <div class="tracking-summary-icon">📦</div>
      <div class="tracking-summary-info">
        <div class="tracking-summary-title">Tracking: ${escapeHtml(tracking)}</div>
        <div class="tracking-summary-sub">
          Status: <strong>${status}</strong><br />
          ${destination ? `Destination: ${destination}<br />` : ''}
          ${lastMile ? `Last-mile: ${lastMile}` : ''}
        </div>
      </div>
    </div>
    <h4 style="font-family: var(--font-display); font-size: var(--fs-md); margin-bottom: var(--sp-3);">Shipment Timeline</h4>
    <div class="tracking-timeline">
      ${eventsHtml}
    </div>
    ${lastMileUrl ? `<a href="${escapeHtml(lastMileUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary" style="width:100%;">🔗 Track with ${lastMile}</a>` : ''}
    <button class="btn btn-primary tracking-label-btn" onclick="downloadShippingLabel('${escapeHtml(tracking)}')">
      📄 Download Shipping Label
    </button>
  `;
}

async function downloadShippingLabel(tracking) {
  const btn = document.querySelector('.tracking-label-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Generating label…';
  }

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated');

    const response = await fetch(`${SUPABASE_URL}/functions/v1/get-shipping-label`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ tracking, label: true }),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Could not download shipping label');
    }

    // The label is returned as a base64-encoded PDF
    const link = document.createElement('a');
    link.href = `data:application/pdf;base64,${result.label}`;
    link.download = `ShipGlobal-Label-${tracking}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Shipping label downloaded!', 'success');
  } catch (err) {
    console.error('downloadShippingLabel error:', err);
    showToast(err.message || 'Could not download shipping label.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '📄 Download Shipping Label';
    }
  }
}

// ── Cancel Shipment / Order ──
async function cancelOrder(tracking) {
  if (!tracking) return;
  const confirmed = window.confirm(
    `Are you sure you want to cancel the shipment with tracking #${tracking}? This will cancel the order with ShipGlobal and trigger a refund.`
  );
  if (!confirmed) return;

  showToast('Cancelling shipment with ShipGlobal…', 'info');

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated');

    const response = await fetch(`${SUPABASE_URL}/functions/v1/cancel-shipment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ tracking }),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || result.message || 'Could not cancel shipment');
    }

    showToast(result.message || 'Shipment cancelled successfully!', 'success');
    await renderOrders();
  } catch (err) {
    console.error('cancelOrder error:', err);
    showToast(err.message || 'Could not cancel shipment.', 'error');
  }
}

// ── Toast Notifications ──
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { success: '✅', error: '❌', info: '💡' };
  const safeMsg = escapeHtml(message);

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || '💡'}</span>
    <span class="toast-message">${safeMsg}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Order Confirmation Email ──
// Calls a Supabase Edge Function that sends a confirmation email via Google SMTP.
// The Edge Function name is 'send-order-email' — deploy it from supabase/functions/.
async function sendOrderConfirmationEmail(order, customer) {
  // Check if Edge Functions are reachable (skips gracefully if not deployed)
  const fnUrl = `${SUPABASE_URL}/functions/v1/send-order-email`;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.access_token) return;

  const items = Array.isArray(order.items) ? order.items : [];
  const itemLines = items.map(it =>
    `• ${it.name} × ${it.qty} — ₹${(it.price * it.qty).toLocaleString('en-IN')}`
  ).join('\n');

  const response = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      orderId: order.id,
      orderShortId: order.id.slice(0, 8).toUpperCase(),
      customerName: customer.name || customer.email,
      customerEmail: customer.email,
      items: itemLines,
      total: Number(order.total).toLocaleString('en-IN'),
      status: order.status || 'processing',
      createdAt: order.created_at,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Edge Function responded ${response.status}: ${errText}`);
  }
  console.log('[Order email] Confirmation sent for order', order.id.slice(0, 8).toUpperCase());
}

// ── Newsletter ──
async function handleNewsletter(e) {
  e.preventDefault();
  const email = sanitizeText(document.getElementById('newsletter-email').value, 254).toLowerCase();
  if (!VALIDATORS.email(email)) {
    showToast('Please enter a valid email.', 'error');
    return;
  }

  try {
    // Optional: persist newsletter signups. Skips silently if table doesn't exist.
    const { error } = await supabaseClient
      .from('newsletter_subscribers')
      .insert({ email });
    if (error && error.code !== '42P01') throw error; // 42P01 = table missing, ignore
  } catch (err) {
    console.warn('Newsletter save skipped:', err.message);
  }

  showToast('Welcome to the RNS Dryfruits family! Check your inbox for 15% off 🎁', 'success');
  document.getElementById('newsletter-email').value = '';
}

// ── Scroll Animations ──
let observerInstance;

function initScrollAnimations() {
  observerInstance = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  document.querySelectorAll('.reveal').forEach(el => {
    observerInstance.observe(el);
  });
}

// ── Navbar Scroll Effect ──
function initNavbarScroll() {
  const navbar = document.getElementById('navbar');
  let ticking = false;

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
        updateActiveNav();
        ticking = false;
      });
      ticking = true;
    }
  });
}

function updateActiveNav() {
  const sections = ['home', 'orders'];
  const scrollPos = window.scrollY + 120;

  sections.forEach(id => {
    const section = document.getElementById(id);
    if (!section) return;
    const top = section.offsetTop;
    const height = section.offsetHeight;

    if (scrollPos >= top && scrollPos < top + height) {
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      const link = document.querySelector(`.nav-link[data-nav="${id}"]`);
      if (link) link.classList.add('active');
    }
  });
}

// ── Smooth Scroll ──
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (!href || href === '#') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        const offset = 80;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
      document.getElementById('nav-links').classList.remove('open');
    });
  });
}

// ── Mobile Menu ──
function toggleMobileMenu() {
  document.getElementById('nav-links').classList.toggle('open');
}

// ── Close modals on Escape ──
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeCart();
    closeAuth();
    closeTracking();
    closeAccountDropdown();
  }
});

// ── Close auth overlay on click outside ──
document.getElementById('auth-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeAuth();
});

// ── Close tracking overlay on click outside ──
document.getElementById('tracking-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeTracking();
});

// ── Close account dropdown on click outside ──
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('account-dropdown');
  if (dropdown && !dropdown.contains(e.target)) {
    closeAccountDropdown();
  }
});
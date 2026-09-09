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
let pendingProfile = null; // { name, phone } saved between register & OTP verify
let otpCooldownTimer = null;

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

  // Restore session on page load
  await restoreSession();
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
      const { error: insertErr } = await supabaseClient
        .from('customers')
        .insert({
          id: userId,
          email: user.email,
          name: sanitizeText(meta.name || user.email.split('@')[0], 100),
          phone: sanitizeText(meta.phone || null, 15),
        });
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

  const isEmpty = cart.length === 0;
  document.getElementById('cart-empty').style.display = isEmpty ? 'flex' : 'none';
  document.getElementById('cart-footer').style.display = isEmpty ? 'none' : 'block';
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

  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
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
    // Send items + claimed total for client UX display, but the DB
    // trigger `aaa_recalc_totals` recomputes and OVERWRITES the total
    // from the authoritative public.products table. Client price lies
    // are silently corrected server-side.
    const { data, error } = await supabaseClient
      .from('orders')
      .insert({
        customer_id: currentUser.id,
        items: orderItems,
        total: total,
      })
      .select()
      .single();

    if (error) throw error;

    const serverTotal = Number(data.total) || total;
    showToast(`Order ${data.id.slice(0, 8).toUpperCase()} placed! Total: ₹${serverTotal.toLocaleString('en-IN')}`, 'success');
    cart = [];
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
function openAuth() {
  clearAuthAlert();
  document.getElementById('auth-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  switchAuthTab('login', document.querySelector('.auth-tab[data-tab="login"]'));
}

function closeAuth() {
  clearAuthAlert();
  document.getElementById('auth-overlay').classList.remove('open');
  document.body.style.overflow = '';
  pendingProfile = null;
}

function switchAuthTab(tab, btn) {
  clearAuthAlert();
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');

  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById(`${tab}-form`).classList.add('active');
}

function showOtpForm(email) {
  clearAuthAlert();
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('otp-form').classList.add('active');
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
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
  pendingProfile = null;
  switchAuthTab('login', document.querySelector('.auth-tab[data-tab="login"]'));
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

// ── Login (existing user, email OTP) ──
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

  pendingProfile = null;
  await requestOtp(email, null, submitBtn);
}

// ── Register (collects name+phone, then sends OTP) ──
async function handleRegister(e) {
  e.preventDefault();
  clearAuthAlert();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const nameRaw = document.getElementById('register-name').value;
  const emailRaw = document.getElementById('register-email').value;
  const phoneRaw = document.getElementById('register-phone').value;
  const termsChecked = document.getElementById('register-terms')?.checked;

  const name = sanitizeText(nameRaw, 100);
  const email = sanitizeText(emailRaw, 254).toLowerCase();
  const phone = sanitizeText(phoneRaw, 15);

  if (!name || !VALIDATORS.name(name)) {
    showAuthAlert('Name must be 2-100 letters, spaces, dots or hyphens.');
    showToast('Name must be 2-100 letters, spaces, dots or hyphens.', 'error');
    return;
  }
  if (!email || !VALIDATORS.email(email)) {
    showAuthAlert('Please enter a valid email address.');
    showToast('Please enter a valid email address.', 'error');
    return;
  }
  if (!phone || !VALIDATORS.phone(phone)) {
    showAuthAlert('Phone must be 7-15 digits (e.g. 9876543210).');
    showToast('Phone must be 7-15 digits (with optional + - ( ) spaces).', 'error');
    return;
  }
  if (!termsChecked) {
    showAuthAlert('Please agree to the Terms & Privacy Policy to continue.');
    return;
  }

  pendingProfile = { name, phone };
  await requestOtp(email, { name, phone }, submitBtn);
}

// ── Send OTP via Supabase ──
async function requestOtp(email, profileData = null, triggerBtn = null) {
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

    // Pass profile data through user_metadata so we can populate customers table on first sign-in
    if (profileData) {
      options.data = {
        name: profileData.name,
        phone: profileData.phone,
      };
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

    // On first sign-in, ensure a customers row exists with profile data
    if (data?.user && pendingProfile) {
      const { error: upsertErr } = await supabaseClient
        .from('customers')
        .upsert({
          id: data.user.id,
          email: data.user.email,
          name: pendingProfile.name,
          phone: pendingProfile.phone,
        }, { onConflict: 'id' });

      if (upsertErr && upsertErr.code !== '23505') throw upsertErr;
      pendingProfile = null;
    }

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
  await requestOtp(email, pendingProfile);
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
  const ordersSection = document.getElementById('orders');
  const ordersLoggedOut = document.getElementById('orders-logged-out');
  const ordersList = document.getElementById('orders-list');

  if (isLoggedIn && currentUser) {
    const initial = (currentUser.name || currentUser.email || '?').charAt(0).toUpperCase();
    accountBtn.innerHTML = `<span style="font-size: 12px; font-weight: 700;">${escapeHtml(initial)}</span>`;
    accountBtn.style.background = 'var(--grad-gold)';
    accountBtn.style.color = 'var(--clr-text-inverse)';
    accountBtn.title = currentUser.email || '';
    accountBtn.onclick = async () => {
      if (confirm('Sign out?')) {
        await supabaseClient.auth.signOut();
        showToast('Signed out successfully', 'info');
      }
    };
    ordersSection.classList.add('visible');
    ordersLoggedOut.style.display = 'none';
    ordersList.style.display = 'flex';
  } else {
    accountBtn.innerHTML = '👤';
    accountBtn.style.background = '';
    accountBtn.style.color = '';
    accountBtn.title = '';
    accountBtn.onclick = openAuth;
    ordersSection.classList.remove('visible');
    ordersLoggedOut.style.display = 'block';
    ordersList.style.display = 'none';
  }
}

// ── Order Tracking: fetch real orders from DB ──
async function renderOrders() {
  const list = document.getElementById('orders-list');
  if (!isLoggedIn || !currentUser) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = '<div style="text-align:center; color: var(--clr-text-secondary); padding: var(--sp-6);">Loading your orders…</div>';

  try {
    const { data, error } = await supabaseClient
      .from('orders')
      .select('id, items, total, status, progress, created_at')
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

  const items = Array.isArray(order.items) ? order.items : [];
  const thumbs = items.map(it => `
    <div class="order-item-thumb" title="${escapeHtml(it.name)}">
      <img src="${escapeHtml(it.image || 'images/cashew_hero.jpg')}" alt="${escapeHtml(it.name)}" onerror="this.src='images/cashew_hero.jpg'" />
    </div>
  `).join('');

  const itemLines = items.map(it => `
    <span style="font-size: var(--fs-xs); color: var(--clr-text-secondary);">${escapeHtml(it.name)} × ${Number(it.qty)}</span>
  `).join('');

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

        <div class="order-total">
          Order Total: <strong>₹${total.toLocaleString('en-IN')}</strong>
        </div>
      </div>
    </div>
  `;
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
  }
});

// ── Close auth overlay on click outside ──
document.getElementById('auth-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeAuth();
});
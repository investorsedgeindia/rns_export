/* ============================================
   NutLux — App Logic (Supabase Edition)
   ============================================ */

// ── Supabase Configuration ──
const SUPABASE_CONFIG = window.SUPABASE_CONFIG || {};

if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
  console.error(
    '[NutLux] Supabase config missing.\n' +
    'Create a config.js file based on config.example.js with your real keys.\n' +
    'See the README or config.example.js for instructions.'
  );
}

const SUPABASE_URL = SUPABASE_CONFIG.url;
const SUPABASE_ANON_KEY = SUPABASE_CONFIG.anonKey;

if (!window.supabase) {
  console.error('Supabase SDK failed to load. Check your network connection.');
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: 'nutlux-auth',
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

const TESTIMONIALS = [
  {
    name: 'Priya Sharma',
    title: 'Verified Buyer',
    text: '"The cashews are incredibly fresh and crunchy. Best quality I\'ve ever had! The packaging is also very premium — perfect for gifting."',
    rating: 5,
  },
  {
    name: 'Rajesh Kumar',
    title: 'Regular Customer',
    text: '"Been ordering from NutLux for 6 months now. The almonds are consistently top-notch. Delivery is always on time. Highly recommend!"',
    rating: 5,
  },
  {
    name: 'Ananya Patel',
    title: 'Verified Buyer',
    text: '"The honey glazed cashews are to die for! Such a unique and delicious flavor. My whole family loves them."',
    rating: 5,
  },
  {
    name: 'Vikram Singh',
    title: 'Gift Buyer',
    text: '"Ordered the Royal Gift Box for Diwali. The presentation was stunning and the quality exceeded expectations. Will order again!"',
    rating: 5,
  },
  {
    name: 'Meera Desai',
    title: 'Health Enthusiast',
    text: '"As a nutritionist, I\'m very particular about quality. NutLux almonds are genuinely premium — no additives, just pure goodness."',
    rating: 4,
  },
];

// ── State ──
let cart = [];
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
  renderProducts('all');
  renderTestimonials();
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

// ── Render Products ──
function renderProducts(filter) {
  const grid = document.getElementById('products-grid');
  const filtered = filter === 'all'
    ? PRODUCTS
    : PRODUCTS.filter(p => p.category === filter);

  grid.innerHTML = filtered.map((p, i) => `
    <div class="product-card reveal reveal-delay-${(i % 4) + 1}" data-category="${escapeHtml(p.category)}">
      ${p.badge ? `<span class="product-card-badge ${escapeHtml(p.badge)}">${escapeHtml(p.badge)}</span>` : ''}
      <div class="product-card-img">
        <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy" />
        <div class="product-card-overlay">
          <button class="btn-icon" title="Quick View" onclick="showToast('Quick view coming soon!', 'info')">👁</button>
          <button class="btn-icon" title="Add to Wishlist" onclick="showToast('Added to wishlist!', 'success')">♡</button>
          <button class="btn-icon" title="Add to Cart" onclick="addToCart(${Number(p.id)})">🛒</button>
        </div>
      </div>
      <div class="product-card-body">
        <div class="product-card-category">${escapeHtml(p.category)}</div>
        <h3 class="product-card-title">${escapeHtml(p.name)}</h3>
        <div class="product-card-weight">${escapeHtml(p.weight)}</div>
        <div class="product-card-rating">
          <div class="product-card-stars">${renderStars(p.rating)}</div>
          <span class="product-card-rating-count">(${p.reviews})</span>
        </div>
        <div class="product-card-footer">
          <div class="product-card-price">
            <span class="current">₹${Number(p.price).toLocaleString('en-IN')}</span>
            ${p.originalPrice ? `<span class="original">₹${Number(p.originalPrice).toLocaleString('en-IN')}</span>` : ''}
          </div>
          <button class="add-to-cart-btn" id="atc-btn-${Number(p.id)}" onclick="addToCart(${Number(p.id)})">
            <span>+</span> Add
          </button>
        </div>
      </div>
    </div>
  `).join('');

  setTimeout(() => {
    document.querySelectorAll('.product-card.reveal').forEach(el => {
      observerInstance.observe(el);
    });
  }, 50);
}

function renderStars(rating) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  let stars = '';
  for (let i = 0; i < full; i++) stars += '★';
  if (half) stars += '½';
  for (let i = full + (half ? 1 : 0); i < 5; i++) stars += '☆';
  return stars;
}

// ── Filter Products ──
function filterProducts(filter, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProducts(filter);
}

// ── Render Testimonials ──
function renderTestimonials() {
  const track = document.getElementById('testimonials-track');
  track.innerHTML = TESTIMONIALS.map(t => `
    <div class="testimonial-card">
      <div class="testimonial-stars">${'★'.repeat(Number(t.rating))}${'☆'.repeat(5 - Number(t.rating))}</div>
      <p class="testimonial-text">${escapeHtml(t.text)}</p>
      <div class="testimonial-author">
        <div class="testimonial-avatar">${escapeHtml(t.name.charAt(0))}</div>
        <div>
          <div class="testimonial-author-name">${escapeHtml(t.name)}</div>
          <div class="testimonial-author-title">${escapeHtml(t.title)}</div>
        </div>
      </div>
    </div>
  `).join('');
}

// ── Cart Functions ──
function addToCart(productId) {
  const id = Number(productId);
  const product = PRODUCTS.find(p => p.id === id);
  if (!product) return;

  const existing = cart.find(item => item.id === id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...product, qty: 1 });
  }

  // Cap quantity to prevent abuse
  if (cart.find(i => i.id === id).qty > 99) {
    cart.find(i => i.id === id).qty = 99;
  }

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
  if (!isLoggedIn || !currentUser) {
    closeCart();
    openAuth();
    showToast('Please sign in to checkout', 'info');
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
function openAuth() {
  document.getElementById('auth-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  switchAuthTab('login', document.querySelector('.auth-tab[data-tab="login"]'));
}

function closeAuth() {
  document.getElementById('auth-overlay').classList.remove('open');
  document.body.style.overflow = '';
  pendingProfile = null;
}

function switchAuthTab(tab, btn) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');

  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById(`${tab}-form`).classList.add('active');
}

function showOtpForm(email) {
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
  const emailRaw = document.getElementById('login-email').value;
  const email = sanitizeText(emailRaw, 254).toLowerCase();

  if (!VALIDATORS.email(email)) {
    showToast('Please enter a valid email address.', 'error');
    return;
  }

  pendingProfile = null;
  await requestOtp(email);
}

// ── Register (collects name+phone, then sends OTP) ──
async function handleRegister(e) {
  e.preventDefault();
  const nameRaw = document.getElementById('register-name').value;
  const emailRaw = document.getElementById('register-email').value;
  const phoneRaw = document.getElementById('register-phone').value;

  const name = sanitizeText(nameRaw, 100);
  const email = sanitizeText(emailRaw, 254).toLowerCase();
  const phone = sanitizeText(phoneRaw, 15);

  if (!VALIDATORS.name(name)) {
    showToast('Name must be 2-100 letters, spaces, dots or hyphens.', 'error');
    return;
  }
  if (!VALIDATORS.email(email)) {
    showToast('Please enter a valid email address.', 'error');
    return;
  }
  if (!VALIDATORS.phone(phone)) {
    showToast('Phone must be 7-15 digits (with optional + - ( ) spaces).', 'error');
    return;
  }

  pendingProfile = { name, phone };
  await requestOtp(email, { name, phone });
}

// ── Send OTP via Supabase ──
async function requestOtp(email, profileData = null) {
  try {
    const options = {
      shouldCreateUser: true,
      emailRedirectTo: window.location.origin,
    };

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
      // Friendly messages for common cases
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('signups not allowed') || msg.includes('signup_disabled')) {
        showToast('New signups are currently disabled. Contact support.', 'error');
      } else if (msg.includes('rate limit') || msg.includes('email rate')) {
        showToast('Too many attempts. Please wait a minute and try again.', 'error');
      } else {
        showToast(error.message || 'Could not send OTP. Please try again.', 'error');
      }
      return;
    }

    console.log('[Supabase signInWithOtp] OTP request sent to', email);
    showOtpForm(email);
    showToast('Check your email for the 6-digit code.', 'success');
  } catch (err) {
    console.error('[OTP request exception]', err);
    showToast(err.message || 'Could not send OTP. Please try again.', 'error');
  }
}

// ── Verify OTP ──
async function handleOtpVerify(e) {
  e.preventDefault();
  const codeRaw = document.getElementById('otp-code').value;
  const emailDisplay = document.getElementById('otp-email-display').textContent;
  const code = sanitizeText(codeRaw, 6);

  if (!VALIDATORS.otp(code)) {
    showToast('Code must be exactly 6 digits.', 'error');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying…';
  }

  try {
    const { data, error } = await supabaseClient.auth.verifyOtp({
      email: emailDisplay,
      token: code,
      type: 'email',
    });

    if (error) throw error;

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
    showToast(err.message || 'Invalid or expired code. Please try again.', 'error');
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

  showToast('Welcome to the NutLux family! Check your inbox for 15% off 🎁', 'success');
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
  const sections = ['home', 'catalogue', 'about', 'testimonials', 'orders'];
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
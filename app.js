/* ============================================
   NutLux — App Logic
   ============================================ */

// ── Product Data ──
const PRODUCTS = [
  {
    id: 1,
    name: 'Premium Whole Cashews',
    category: 'cashew',
    weight: '500g',
    price: 899,
    originalPrice: 1099,
    rating: 4.9,
    reviews: 342,
    badge: 'bestseller',
    image: 'images/cashew_hero.jpg',
    description: 'W240 grade, hand-sorted whole cashew nuts roasted to perfection.',
  },
  {
    id: 2,
    name: 'California Almonds',
    category: 'almond',
    weight: '500g',
    price: 749,
    originalPrice: 949,
    rating: 4.8,
    reviews: 278,
    badge: 'bestseller',
    image: 'images/almond_hero.jpg',
    description: 'Premium California almonds, naturally dried and packed for freshness.',
  },
  {
    id: 3,
    name: 'Sea Salt Cashews',
    category: 'cashew',
    weight: '250g',
    price: 549,
    originalPrice: null,
    rating: 4.7,
    reviews: 186,
    badge: 'new',
    image: 'images/cashew_salted.jpg',
    description: 'Lightly salted with Himalayan pink salt for a delicate savory crunch.',
  },
  {
    id: 4,
    name: 'Blanched Sliced Almonds',
    category: 'almond',
    weight: '200g',
    price: 449,
    originalPrice: 599,
    rating: 4.6,
    reviews: 124,
    badge: null,
    image: 'images/almond_sliced.jpg',
    description: 'Perfect for baking and garnishing. Thinly sliced blanched almonds.',
  },
  {
    id: 5,
    name: 'Honey Glazed Cashews',
    category: 'cashew',
    weight: '250g',
    price: 649,
    originalPrice: null,
    rating: 4.9,
    reviews: 215,
    badge: 'new',
    image: 'images/cashew_honey.jpg',
    description: 'Coated in pure organic honey glaze with a hint of sesame.',
  },
  {
    id: 6,
    name: 'Roasted Almond Mix',
    category: 'almond',
    weight: '400g',
    price: 699,
    originalPrice: 849,
    rating: 4.7,
    reviews: 167,
    badge: 'sale',
    image: 'images/almond_hero.jpg',
    description: 'A robust mix of whole and slivered almonds, perfectly roasted.',
  },
  {
    id: 7,
    name: 'Royal Nut Gift Box',
    category: 'combo',
    weight: '1kg',
    price: 1999,
    originalPrice: 2499,
    rating: 5.0,
    reviews: 89,
    badge: 'bestseller',
    image: 'images/hero_banner.jpg',
    description: 'An exquisite gift box with premium cashews and almonds. Perfect for festive gifting.',
  },
  {
    id: 8,
    name: 'Daily Nut Duo Pack',
    category: 'combo',
    weight: '500g',
    price: 1299,
    originalPrice: 1549,
    rating: 4.8,
    reviews: 134,
    badge: null,
    image: 'images/cashew_salted.jpg',
    description: 'A daily dose pack with equal portions of premium cashews and almonds.',
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

const SAMPLE_ORDERS = [
  {
    id: 'NL-2024-1847',
    date: '28 Aug 2024',
    status: 'delivered',
    progress: 100,
    items: [
      { name: 'Premium Whole Cashews', qty: 2, image: 'images/cashew_hero.jpg' },
      { name: 'California Almonds', qty: 1, image: 'images/almond_hero.jpg' },
    ],
    total: 2547,
  },
  {
    id: 'NL-2024-1902',
    date: '30 Aug 2024',
    status: 'shipped',
    progress: 66,
    items: [
      { name: 'Honey Glazed Cashews', qty: 1, image: 'images/cashew_honey.jpg' },
      { name: 'Royal Nut Gift Box', qty: 1, image: 'images/hero_banner.jpg' },
    ],
    total: 2648,
  },
  {
    id: 'NL-2024-1958',
    date: '1 Sep 2024',
    status: 'processing',
    progress: 33,
    items: [
      { name: 'Sea Salt Cashews', qty: 3, image: 'images/cashew_salted.jpg' },
    ],
    total: 1647,
  },
];

// ── State ──
let cart = [];
let isLoggedIn = false;
let currentUser = null;

// ── Initialization ──
document.addEventListener('DOMContentLoaded', () => {
  renderProducts('all');
  renderTestimonials();
  initScrollAnimations();
  initNavbarScroll();
  initSmoothScroll();
});

// ── Render Products ──
function renderProducts(filter) {
  const grid = document.getElementById('products-grid');
  const filtered = filter === 'all'
    ? PRODUCTS
    : PRODUCTS.filter(p => p.category === filter);

  grid.innerHTML = filtered.map((p, i) => `
    <div class="product-card reveal reveal-delay-${(i % 4) + 1}" data-category="${p.category}">
      ${p.badge ? `<span class="product-card-badge ${p.badge}">${p.badge}</span>` : ''}
      <div class="product-card-img">
        <img src="${p.image}" alt="${p.name}" loading="lazy" />
        <div class="product-card-overlay">
          <button class="btn-icon" title="Quick View" onclick="showToast('Quick view coming soon!', 'info')">👁</button>
          <button class="btn-icon" title="Add to Wishlist" onclick="showToast('Added to wishlist!', 'success')">♡</button>
          <button class="btn-icon" title="Add to Cart" onclick="addToCart(${p.id})">🛒</button>
        </div>
      </div>
      <div class="product-card-body">
        <div class="product-card-category">${p.category}</div>
        <h3 class="product-card-title">${p.name}</h3>
        <div class="product-card-weight">${p.weight}</div>
        <div class="product-card-rating">
          <div class="product-card-stars">${renderStars(p.rating)}</div>
          <span class="product-card-rating-count">(${p.reviews})</span>
        </div>
        <div class="product-card-footer">
          <div class="product-card-price">
            <span class="current">₹${p.price}</span>
            ${p.originalPrice ? `<span class="original">₹${p.originalPrice}</span>` : ''}
          </div>
          <button class="add-to-cart-btn" id="atc-btn-${p.id}" onclick="addToCart(${p.id})">
            <span>+</span> Add
          </button>
        </div>
      </div>
    </div>
  `).join('');

  // Re-trigger scroll animations for new elements
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
      <div class="testimonial-stars">${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}</div>
      <p class="testimonial-text">${t.text}</p>
      <div class="testimonial-author">
        <div class="testimonial-avatar">${t.name.charAt(0)}</div>
        <div>
          <div class="testimonial-author-name">${t.name}</div>
          <div class="testimonial-author-title">${t.title}</div>
        </div>
      </div>
    </div>
  `).join('');
}

// ── Cart Functions ──
function addToCart(productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return;

  const existing = cart.find(item => item.id === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...product, qty: 1 });
  }

  updateCartUI();
  showToast(`${product.name} added to cart!`, 'success');

  // Button animation
  const btn = document.getElementById(`atc-btn-${productId}`);
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
  cart = cart.filter(item => item.id !== productId);
  updateCartUI();
  renderCartItems();
}

function updateQty(productId, delta) {
  const item = cart.find(i => i.id === productId);
  if (!item) return;

  item.qty += delta;
  if (item.qty <= 0) {
    removeFromCart(productId);
    return;
  }

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

  // Remove existing cart items (not the empty state)
  container.querySelectorAll('.cart-item').forEach(el => el.remove());

  cart.forEach(item => {
    const el = document.createElement('div');
    el.className = 'cart-item';
    el.innerHTML = `
      <div class="cart-item-img">
        <img src="${item.image}" alt="${item.name}" />
      </div>
      <div class="cart-item-info">
        <div class="cart-item-title">${item.name}</div>
        <div class="cart-item-variant">${item.weight}</div>
        <div class="cart-item-controls">
          <div class="qty-control">
            <button class="qty-btn" onclick="updateQty(${item.id}, -1)">−</button>
            <span class="qty-value">${item.qty}</span>
            <button class="qty-btn" onclick="updateQty(${item.id}, 1)">+</button>
          </div>
          <span class="cart-item-price">₹${(item.price * item.qty).toLocaleString('en-IN')}</span>
          <button class="cart-item-remove" onclick="removeFromCart(${item.id})">🗑</button>
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

function handleCheckout() {
  if (!isLoggedIn) {
    closeCart();
    openAuth();
    showToast('Please sign in to checkout', 'info');
    return;
  }
  showToast('Checkout functionality coming soon!', 'info');
}

// ── Auth Functions ──
function openAuth() {
  document.getElementById('auth-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeAuth() {
  document.getElementById('auth-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function switchAuthTab(tab, btn) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById(`${tab}-form`).classList.add('active');
}

function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  
  // Simulated login
  isLoggedIn = true;
  currentUser = { name: email.split('@')[0], email };
  
  closeAuth();
  showToast(`Welcome back, ${currentUser.name}!`, 'success');
  updateAuthUI();
  renderOrders();
}

function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('register-name').value;
  const email = document.getElementById('register-email').value;

  // Simulated registration
  isLoggedIn = true;
  currentUser = { name, email };
  
  closeAuth();
  showToast(`Welcome to NutLux, ${name}! 🎉`, 'success');
  updateAuthUI();
  renderOrders();
}

function updateAuthUI() {
  const accountBtn = document.getElementById('account-btn');
  if (isLoggedIn) {
    accountBtn.innerHTML = `<span style="font-size: 12px; font-weight: 700;">${currentUser.name.charAt(0).toUpperCase()}</span>`;
    accountBtn.style.background = 'var(--grad-gold)';
    accountBtn.style.color = 'var(--clr-text-inverse)';
    accountBtn.onclick = () => {
      if (confirm('Sign out?')) {
        isLoggedIn = false;
        currentUser = null;
        accountBtn.innerHTML = '👤';
        accountBtn.style.background = '';
        accountBtn.style.color = '';
        accountBtn.onclick = openAuth;
        updateAuthUI();
        showToast('Signed out successfully', 'info');
      }
    };
  }

  // Show/hide orders link
  const ordersSection = document.getElementById('orders');
  const ordersLoggedOut = document.getElementById('orders-logged-out');
  const ordersList = document.getElementById('orders-list');
  
  if (isLoggedIn) {
    ordersSection.classList.add('visible');
    ordersLoggedOut.style.display = 'none';
    ordersList.style.display = 'flex';
  } else {
    ordersLoggedOut.style.display = 'block';
    ordersList.style.display = 'none';
  }
}

// ── Order Tracking ──
function renderOrders() {
  const list = document.getElementById('orders-list');
  list.innerHTML = SAMPLE_ORDERS.map(order => `
    <div class="order-card">
      <div class="order-card-header">
        <span class="order-id">${order.id}</span>
        <span class="order-date">Ordered: ${order.date}</span>
        <span class="order-status ${order.status}">${order.status}</span>
      </div>
      <div class="order-card-body">
        <div class="order-items-preview">
          ${order.items.map(item => `
            <div class="order-item-thumb">
              <img src="${item.image}" alt="${item.name}" />
            </div>
          `).join('')}
          <div style="display:flex; flex-direction:column; justify-content:center; margin-left: var(--sp-2);">
            ${order.items.map(item => `
              <span style="font-size: var(--fs-xs); color: var(--clr-text-secondary);">${item.name} × ${item.qty}</span>
            `).join('')}
          </div>
        </div>
        
        <div class="order-timeline">
          <div class="order-timeline-progress" style="width: ${order.progress}%;"></div>
          <div class="timeline-step ${order.progress >= 10 ? 'completed' : ''}">
            <div class="timeline-step-dot">✓</div>
            <span class="timeline-step-label">Confirmed</span>
          </div>
          <div class="timeline-step ${order.progress >= 33 ? 'completed' : ''} ${order.progress >= 25 && order.progress < 50 ? 'active' : ''}">
            <div class="timeline-step-dot">${order.progress >= 33 ? '✓' : ''}</div>
            <span class="timeline-step-label">Processing</span>
          </div>
          <div class="timeline-step ${order.progress >= 66 ? 'completed' : ''} ${order.progress >= 50 && order.progress < 80 ? 'active' : ''}">
            <div class="timeline-step-dot">${order.progress >= 66 ? '✓' : ''}</div>
            <span class="timeline-step-label">Shipped</span>
          </div>
          <div class="timeline-step ${order.progress >= 100 ? 'completed' : ''} ${order.progress >= 80 && order.progress < 100 ? 'active' : ''}">
            <div class="timeline-step-dot">${order.progress >= 100 ? '✓' : ''}</div>
            <span class="timeline-step-label">Delivered</span>
          </div>
        </div>

        <div class="order-total">
          Order Total: <strong>₹${order.total.toLocaleString('en-IN')}</strong>
        </div>
      </div>
    </div>
  `).join('');
}

// ── Toast Notifications ──
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = { success: '✅', error: '❌', info: '💡' };
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <span class="toast-message">${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Newsletter ──
function handleNewsletter(e) {
  e.preventDefault();
  const email = document.getElementById('newsletter-email').value;
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
      e.preventDefault();
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        const offset = 80;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
      // Close mobile menu
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

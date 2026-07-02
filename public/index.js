// --- SUPABASE CLIENT ---
let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';
let supabaseClient = null;

// --- OBTENER NÚMERO DE WHATSAPP PREDETERMINADO (Socio con más productos asignados) ---
window.getDefaultContactNumber = () => {
    if (!state.contacts || state.contacts.length === 0) return '59178986924'; // Fallback absoluto
    
    // Contar cuántos productos tiene asignado cada contacto
    const counts = {};
    if (state.products && state.products.length > 0) {
        state.products.forEach(p => {
            if (p.contactId) {
                counts[p.contactId] = (counts[p.contactId] || 0) + 1;
            }
        });
    }
    
    let bestContact = null;
    let maxCount = -1;
    
    state.contacts.forEach(c => {
        const count = counts[c.id] || 0;
        if (count > maxCount) {
            maxCount = count;
            bestContact = c;
        }
    });
    
    if (bestContact && bestContact.number) {
        let num = bestContact.number.replace(/\D/g, '');
        if (!num.startsWith('591') && num.length === 8) {
            num = '591' + num;
        }
        return num;
    }
    
    // Fallback: el primer contacto disponible
    if (state.contacts[0] && state.contacts[0].number) {
        let num = state.contacts[0].number.replace(/\D/g, '');
        if (!num.startsWith('591') && num.length === 8) {
            num = '591' + num;
        }
        return num;
    }
    
    return '59178986924';
};

// --- ESTADO GLOBAL ---
const state = {
    view: 'home',
    products: [],
    categories: [],
    contacts: [],
    promotions: [],
    cart: JSON.parse(localStorage.getItem('emma_store_cart')) || [],
    selectedCategory: 'todas',
    selectedProduct: null,
    detailActiveImg: 0,
    detailSlideInterval: null,
    userInteractionTimeout: null,
    searchQuery: '',
    // Google Auth & Ubicación de Departamento
    user: null,
    supabaseSession: null,
    addresses: [],
    selectedDepartment: localStorage.getItem('emma_store_dept') || 'Cochabamba',
    pendingAction: null,
    isGuest: false,
    isEditingName: false,
    isEditingAddress: false,
    editingAddressId: null,
    filters: {
        sort: 'recent',
        availableOnly: false,
        minPrice: 0,
        maxPrice: 1000,
        currentMin: 0,
        currentMax: 1000
    },
    // Configuración de entrega (cargada desde el servidor)
    storeConfig: {
        shipping_cost: 15,
        carrier_cost: 25,
        delivery_zones: ['Cochabamba'],
        shipping_options: []
    }
};

// Migrate old numeric IDs in cart to string prefixes to avoid promotions collisions
state.cart = state.cart.map(item => {
    if (typeof item.id === 'number') {
        item.id = `prod_${item.id}`;
    }
    return item;
});

// --- HELPER: Auth Token para API ---
function getAuthHeaders() {
    if (!state.supabaseSession) return {};
    return { 'Authorization': `Bearer ${state.supabaseSession.access_token}` };
}

// --- MOTOR DE DATOS ---
async function loadData() {
    try {
        // Cargar datos de productos (MySQL/Aiven)
        const [p, cat, con, s, storeConf] = await Promise.all([
            fetch('/api/products').then(r => r.json()),
            fetch('/api/categories').then(r => r.json()),
            fetch('/api/contacts').then(r => r.json()),
            fetch('/api/promotions').then(r => r.json()),
            fetch('/api/store-config').then(r => r.json()).catch(() => ({ shipping_cost: 15, carrier_cost: 25, delivery_zones: ['Cochabamba'] }))
        ]);
        if (storeConf && !storeConf.error) {
            state.storeConfig = {
                shipping_cost: parseFloat(storeConf.shipping_cost) || 15,
                carrier_cost: parseFloat(storeConf.carrier_cost) || 25,
                delivery_zones: storeConf.delivery_zones || ['Cochabamba'],
                shipping_options: storeConf.shipping_options || [],
                qr_payment_url: storeConf.qr_payment_url || null
            };
        }
        state.products = p.map(prod => ({ 
            ...prod, 
            price: parseFloat(prod.price) || 0,
            inStock: true 
        }));
        state.categories = cat;
        state.contacts = con;
        state.promotions = s;

        // Actualizar enlace de WhatsApp del footer dinámicamente según el vendedor con más productos
        try {
            const footerWaLink = document.querySelector('a[href*="wa.me/59178986924"]');
            if (footerWaLink) {
                footerWaLink.href = 'https://wa.me/' + window.getDefaultContactNumber();
            }
        } catch (_) {}

        // Selección estable de categoría y producto aleatorio para la landing page
        if (state.categories.length > 0) {
            const randomCat = state.categories[Math.floor(Math.random() * state.categories.length)];
            state.randomCategoryId = randomCat.id;
            state.randomCategoryName = randomCat.name;
        }
        if (state.products.length > 0) {
            const randomProd = state.products[Math.floor(Math.random() * state.products.length)];
            state.randomProductId = randomProd.id;
            
            // Seleccionar 5 productos destacados estables para el carrusel de spotlight
            const withDesc = state.products.filter(p => p.description && p.description.length > 20);
            const sourceList = withDesc.length >= 3 ? withDesc : state.products;
            state.spotlightProducts = [...sourceList].sort(() => 0.5 - Math.random()).slice(0, 5);
        }
        setTimeout(updateCatalogDropdown, 100);
        
        const prices = state.products.map(prod => prod.price);
        const minPrice = prices.length ? Math.min(...prices) : 0;
        const maxPrice = prices.length ? Math.max(...prices) : 1000;
        state.filters.minPrice = minPrice;
        state.filters.maxPrice = maxPrice;
        state.filters.currentMin = minPrice;
        state.filters.currentMax = maxPrice;

        // Configurar Supabase dinámicamente desde el backend
        try {
            const configRes = await fetch('/api/config');
            if (configRes.ok) {
                const config = await configRes.json();
                SUPABASE_URL = config.supabaseUrl;
                SUPABASE_ANON_KEY = config.supabaseAnonKey;
                if (SUPABASE_URL && SUPABASE_ANON_KEY) {
                    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
                    
                    // --- LISTENER DE AUTENTICACIÓN SUPABASE ---
                    supabaseClient.auth.onAuthStateChange((event, session) => {
                        if (event === 'SIGNED_IN' && session) {
                            handleLoginSuccess(session.user, session);
                        } else if (event === 'SIGNED_OUT') {
                            state.user = null;
                            state.supabaseSession = null;
                            state.addresses = [];
                            updateAccountUI();
                        } else if (event === 'TOKEN_REFRESHED' && session) {
                            state.supabaseSession = session;
                        }
                    });
                }
            }
        } catch (configErr) { console.error("Error cargando configuración Supabase:", configErr); }

        // Restaurar sesión de Supabase (si ya estaba logueado)
        try {
            if (supabaseClient) {
                const { data: { session } } = await supabaseClient.auth.getSession();
                if (session) {
                    state.supabaseSession = session;
                    let phone = '';
                    let dbName = '';
                    try {
                        const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', session.user.id).single();
                        if (profile) {
                            phone = profile.phone || '';
                            dbName = profile.full_name || '';
                        }
                    } catch (e) { console.error(e); }
                    
                    state.user = {
                        id: session.user.id,
                        name: dbName || session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || '',
                        email: session.user.email || '',
                        photo: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || '',
                        phone: phone
                    };
                    loadUserAddresses();
                }
            }
        } catch (authErr) { console.error("Error restaurando sesión:", authErr); }

        initRouter();
        updateCartUI();
    } catch (e) { 
        console.error("Error cargando datos:", e); 
        alert("Hubo un error cargando los datos. Por favor recarga la página.");
    } finally {
        document.getElementById('loading-overlay')?.classList.add('hidden');
        setTimeout(() => {
            updateLogoTransition();
        }, 150);
    }
}

// --- FORMATO CUENTA REGRESIVA DE PROMOCIONES ---
function formatCountdown(endsAt) {
    const diff = endsAt - Date.now();
    if (diff <= 0) return "Vencido";
    
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((diff % (60 * 1000)) / 1000);
    
    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    
    return parts.join(' ');
}

window.viewPromotion = (promoId) => {
    const promo = state.promotions.find(p => p.id == promoId);
    if (!promo) return;
    
    state.selectedProduct = promo;
    state.detailActiveImg = 0;
    
    window.navigate('detail');
};

// --- FUNCIONALIDAD LIGHTBOX PRO ---
window.openLightbox = () => {
    const p = state.selectedProduct;
    if (!p) return;
    
    let modal = document.getElementById('lightbox-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'lightbox-modal';
        modal.className = "fixed inset-0 z-[2000] bg-black flex items-center justify-center invisible opacity-0 transition-all duration-300";
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/95 backdrop-blur-sm" onclick="window.closeLightbox()"></div>
            <button onclick="event.stopPropagation(); window.prevImg()" class="absolute left-6 z-10 text-white/50 hover:text-white text-4xl transition-colors p-4">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <div class="relative max-w-[90%] max-h-[90%] overflow-hidden flex items-center justify-center">
                <img id="lightbox-img" class="max-w-full max-h-full object-contain shadow-2xl transition-transform duration-500 cursor-zoom-in" 
                     onclick="window.toggleZoom(this)">
            </div>
            <button onclick="event.stopPropagation(); window.nextImg()" class="absolute right-6 z-10 text-white/50 hover:text-white text-4xl transition-colors p-4">
                <i class="fa-solid fa-chevron-right"></i>
            </button>
            <button onclick="window.closeLightbox()" class="absolute top-10 right-10 text-white/50 hover:text-white text-5xl font-light p-4">&times;</button>
        `;
        document.body.appendChild(modal);
    }
    updateLightboxUI();
    modal.classList.remove('invisible', 'opacity-0');
};

window.updateLightboxUI = () => {
    const p = state.selectedProduct;
    const img = document.getElementById('lightbox-img');
    if (img && p) {
        img.src = p.images[state.detailActiveImg];
        img.style.transform = "scale(1)"; 
        img.classList.replace('cursor-zoom-out', 'cursor-zoom-in');
    }
};

window.toggleZoom = (el) => {
    if (el.style.transform === "scale(2)") {
        el.style.transform = "scale(1)";
        el.classList.replace('cursor-zoom-out', 'cursor-zoom-in');
    } else {
        el.style.transform = "scale(2)";
        el.classList.replace('cursor-zoom-in', 'cursor-zoom-out');
    }
};

window.closeLightbox = () => {
    const modal = document.getElementById('lightbox-modal');
    if (modal) {
        modal.classList.add('invisible', 'opacity-0');
        const img = document.getElementById('lightbox-img');
        if (img) img.style.transform = "scale(1)";
    }
};

// --- LÓGICA DE GALERÍA DETALLE ---
window.changeDetailImg = (index, isUserAction = false) => {
    const p = state.selectedProduct;
    if (!p || !p.images[index]) return;
    
    state.detailActiveImg = index;
    const imgMain = document.getElementById('detail-main-img');
    
    if (imgMain) {
        imgMain.style.opacity = '0';
        setTimeout(() => {
            imgMain.src = p.images[index];
            imgMain.style.opacity = '1';
            const lImg = document.getElementById('lightbox-img');
            if (lImg) lImg.src = p.images[index];
        }, 200);
    }

    document.querySelectorAll('.thumb-btn').forEach((btn, i) => {
        btn.classList.toggle('border-black', i === index);
        btn.classList.toggle('opacity-50', i !== index);
    });

    if (isUserAction) {
        clearInterval(state.detailSlideInterval);
        clearTimeout(state.userInteractionTimeout);
        state.userInteractionTimeout = setTimeout(() => {
            startDetailAutoSlide();
        }, 10000); 
    }
};

window.nextImg = () => {
    const next = (state.detailActiveImg + 1) % state.selectedProduct.images.length;
    changeDetailImg(next, true);
};

window.prevImg = () => {
    const prev = (state.detailActiveImg - 1 + state.selectedProduct.images.length) % state.selectedProduct.images.length;
    changeDetailImg(prev, true);
};

function startDetailAutoSlide() {
    clearInterval(state.detailSlideInterval);
    state.detailSlideInterval = setInterval(() => {
        const p = state.selectedProduct;
        if (p && p.images && p.images.length > 1 && state.view === 'detail') {
            const next = (state.detailActiveImg + 1) % p.images.length;
            changeDetailImg(next, false);
        }
    }, 4000);
}

// --- FUNCIONES DEL CARRITO ---
window.toggleCart = (isOpen) => {
    const sidebar = document.getElementById('cart-sidebar');
    const content = document.getElementById('cart-content');
    if (isOpen) {
        sidebar.classList.remove('invisible', 'opacity-0');
        content.classList.remove('translate-x-full');
        updateCartUI();
    } else {
        content.classList.add('translate-x-full');
        setTimeout(() => sidebar.classList.add('invisible', 'opacity-0'), 500);
    }
};

function updateCartUI() {
    localStorage.setItem('emma_store_cart', JSON.stringify(state.cart));
    const total = state.cart.reduce((s, i) => s + (i.price * i.quantity), 0);
    const count = state.cart.reduce((s, i) => s + i.quantity, 0);
    document.getElementById('cart-count').innerText = count;
    document.getElementById('cart-count').classList.toggle('hidden', count === 0);
    
    const mobileBadge = document.getElementById('mobile-cart-badge');
    if (mobileBadge) {
        mobileBadge.innerText = count;
        mobileBadge.classList.toggle('hidden', count === 0);
    }
    document.getElementById('header-cart-total').innerText = `BS ${total.toFixed(2)}`;
    document.getElementById('cart-total').innerText = `BS ${total.toFixed(2)}`;
    const list = document.getElementById('cart-items-list');
    list.innerHTML = state.cart.length ? state.cart.map(i => `
        <div class="flex gap-4 items-center bg-white p-4 rounded-2xl border mb-3 shadow-sm animate-fade">
            <img src="${i.images[0]}" class="w-14 h-14 object-cover rounded-xl border">
            <div class="flex-1">
                <h4 class="text-[10px] font-black uppercase text-black truncate">${i.name}</h4>
                <div class="flex justify-between items-center mt-3">
                    <div class="flex items-center gap-3 bg-gray-50 px-2.5 py-1.5 rounded-full border">
                        <button onclick="changeCartQty('${i.id}', -1)" class="text-gray-400 hover:text-black font-bold text-xs">－</button>
                        <span class="text-[10px] font-black">${i.quantity}</span>
                        <button onclick="changeCartQty('${i.id}', 1)" class="text-gray-400 hover:text-black font-bold text-xs">＋</button>
                    </div>
                    <p class="text-[10px] font-black">BS ${(i.price * i.quantity).toFixed(2)}</p>
                </div>
            </div>
        </div>`).join('') : '<div class="text-center py-20 opacity-20 text-[10px] font-black uppercase">Bolsa Vacía</div>';
}

window.changeCartQty = (id, d) => {
    const i = state.cart.find(x => x.id == id);
    if (i) { 
        i.quantity += d; 
        if (i.quantity <= 0) state.cart = state.cart.filter(x => x.id != id); 
    }
    updateCartUI();
};

window.addToCart = (id, q = null) => {
    const qty = q !== null ? q : 1;
    const isPromo = typeof id === 'string' && id.startsWith('promo_');
    const isProd = typeof id === 'string' && id.startsWith('prod_');
    
    let realId = id;
    let isPromoItem = isPromo;
    
    if (isPromo) {
        realId = parseInt(id.replace('promo_', ''));
    } else if (isProd) {
        realId = parseInt(id.replace('prod_', ''));
    } else {
        realId = parseInt(id);
    }
    
    const cartId = isPromoItem ? `promo_${realId}` : `prod_${realId}`;
    const p = isPromoItem 
        ? state.promotions.find(x => x.id == realId)
        : state.products.find(x => x.id == realId);
        
    if (!p) return;
    
    const e = state.cart.find(x => x.id === cartId);
    if (e) {
        e.quantity += qty;
    } else {
        state.cart.push({ ...p, id: cartId, quantity: qty });
    }
    updateCartUI(); toggleCart(true);
};

// --- CATÁLOGO HOVER ---
window.startCatalogHoverSlide = (el, imagesJson) => {
    const imgs = JSON.parse(decodeURIComponent(imagesJson));
    if (!imgs || imgs.length < 2) return;
    let cur = 0; 
    const imgEl = el.querySelector('.product-image');
    el._slideInt = setInterval(() => { 
        cur = (cur + 1) % imgs.length; 
        imgEl.src = imgs[cur]; 
    }, 1800);
};

window.stopCatalogHoverSlide = (el, first) => { 
    clearInterval(el._slideInt); 
    const img = el.querySelector('.product-image'); 
    img.src = first; 
};

// --- SISTEMA DE GOOGLE AUTH REAL (SUPABASE) ---
window.openGoogleLogin = async () => {
    localStorage.setItem('emma_terms_accepted', 'true');
    try {
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin
            }
        });
        if (error) {
            console.error('Error Google OAuth:', error);
            showNotification('Error al iniciar sesión');
        }
    } catch (err) {
        console.error('Error abriendo Google login:', err);
    }
};

window.logout = async () => {
    try {
        await supabaseClient.auth.signOut();
    } catch (err) {
        console.error('Error cerrando sesión:', err);
    }
    state.user = null;
    state.supabaseSession = null;
    state.addresses = [];
    updateAccountUI();
    showNotification("Sesión cerrada");
};

// Cerrar dropdown al hacer clic fuera
document.addEventListener('click', (e) => {
    const container = document.getElementById('account-menu-container');
    const dropdown = document.getElementById('account-dropdown');
    if (container && !container.contains(e.target) && dropdown) {
        dropdown.classList.add('hidden');
    }
});

window.toggleAccountMenu = () => {
    if (state.user) {
        window.openAccountDrawer();
        return;
    }
    const dropdown = document.getElementById('account-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('hidden');
    }
};

window.openAccountDrawer = () => {
    const drawer = document.getElementById('account-drawer');
    const card = document.getElementById('account-drawer-card');
    const emailEl = document.getElementById('account-drawer-email');
    if (drawer && card && state.user) {
        if (emailEl) emailEl.innerText = state.user.email;
        drawer.classList.remove('invisible', 'opacity-0');
        card.classList.remove('translate-y-full', 'sm:scale-90');
        card.classList.add('translate-y-0', 'sm:scale-100');
    }
};

window.closeAccountDrawer = () => {
    const drawer = document.getElementById('account-drawer');
    const card = document.getElementById('account-drawer-card');
    if (drawer && card) {
        card.classList.remove('translate-y-0', 'sm:scale-100');
        card.classList.add('translate-y-full', 'sm:scale-90');
        setTimeout(() => {
            drawer.classList.add('invisible', 'opacity-0');
        }, 300);
    }
};

window.navigateFromDrawer = (view) => {
    window.closeAccountDrawer();
    window.navigate(view);
};

window.navigateFromDropdown = (view) => {
    const dropdown = document.getElementById('account-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
    window.navigate(view);
};

window.openDepartmentModal = () => {
    const modal = document.getElementById('dept-modal');
    const card = document.getElementById('dept-modal-card');
    if (modal && card) {
        modal.classList.remove('invisible', 'opacity-0');
        card.classList.remove('scale-90');
        card.classList.add('scale-100');
    }
};

window.closeDepartmentModal = () => {
    const modal = document.getElementById('dept-modal');
    const card = document.getElementById('dept-modal-card');
    if (modal && card) {
        card.classList.remove('scale-100');
        card.classList.add('scale-90');
        setTimeout(() => {
            modal.classList.add('invisible', 'opacity-0');
        }, 150);
    }
};

window.selectDepartment = (dept) => {
    state.selectedDepartment = dept;
    localStorage.setItem('emma_store_dept', dept);
    updateDepartmentUI();
    closeDepartmentModal();
    showNotification(`Ubicación de envío: ${dept}`);
};

window.openLoginHookModal = (actionPending = null) => {
    state.pendingAction = actionPending;
    const modal = document.getElementById('login-hook-modal');
    const card = document.getElementById('login-hook-card');
    if (modal && card) {
        modal.classList.remove('invisible', 'opacity-0');
        card.classList.remove('scale-90');
        card.classList.add('scale-100');
    }
};

window.acceptPrivacyAndContinue = () => {
    localStorage.setItem('emma_privacy_accepted', 'true');
    window.closeLoginHookModal();
    if (state.pendingAction) {
        const action = state.pendingAction;
        state.pendingAction = null;
        action();
    }
};

window.closeLoginHookModal = () => {
    const modal = document.getElementById('login-hook-modal');
    const card = document.getElementById('login-hook-card');
    if (modal && card) {
        card.classList.remove('scale-100');
        card.classList.add('scale-90');
        setTimeout(() => {
            modal.classList.add('invisible', 'opacity-0');
        }, 150);
    }
};

function handleLoginSuccess(supabaseUser, session) {
    state.supabaseSession = session;
    state.user = {
        id: supabaseUser.id,
        name: supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || supabaseUser.email?.split('@')[0] || '',
        email: supabaseUser.email || '',
        photo: supabaseUser.user_metadata?.avatar_url || supabaseUser.user_metadata?.picture || ''
    };
    updateAccountUI();
    closeLoginHookModal();
    
    // Cargar direcciones del usuario
    loadUserAddresses();
    
    if (state.pendingAction) {
        const action = state.pendingAction;
        state.pendingAction = null;
        action();
    }
    
    showNotification(`¡Bienvenido, ${state.user.name.split(' ')[0]}!`);
}

window.continueAsGuest = () => {
    localStorage.setItem('emma_terms_accepted', 'true');
    state.user = null; // Ensure no user object exists
    state.supabaseSession = null;
    state.isGuest = true;
    closeLoginHookModal();
    if (state.pendingAction) {
        const action = state.pendingAction;
        state.pendingAction = null;
        action();
    }
};

window.showPrivacyPolicy = (updateUrl = true) => {
    const modal = document.getElementById('privacy-policy-modal');
    const card = document.getElementById('privacy-policy-card');
    if (modal && card) {
        modal.classList.remove('invisible', 'opacity-0');
        card.classList.remove('scale-90');
        card.classList.add('scale-100');
        
        if (updateUrl) {
            const params = new URLSearchParams(window.location.search);
            params.set('modal', 'privacy');
            window.history.pushState({ ...history.state }, '', '?' + params.toString());
        }
    }
};

window.closePrivacyPolicy = () => {
    const modal = document.getElementById('privacy-policy-modal');
    const card = document.getElementById('privacy-policy-card');
    if (modal && card) {
        modal.classList.add('invisible', 'opacity-0');
        card.classList.remove('scale-100');
        card.classList.add('scale-90');
        
        const params = new URLSearchParams(window.location.search);
        if (params.get('modal') === 'privacy') {
            params.delete('modal');
            const newUrl = params.toString() ? '?' + params.toString() : window.location.pathname;
            window.history.pushState({ ...history.state }, '', newUrl);
        }
    }
};

window.updateLoginButtonsState = () => {};

async function loadUserAddresses() {
    if (!state.supabaseSession) return;
    try {
        const res = await fetch('/api/user/addresses', {
            headers: { ...getAuthHeaders() }
        });
        if (res.ok) {
            state.addresses = await res.json();
        }
    } catch (err) { console.error('Error cargando direcciones:', err); }
}

function updateAccountUI() {
    const dropdownContent = document.getElementById('account-dropdown-content');
    const accountBtn = document.querySelector('#account-menu-container button');
    
    if (accountBtn) {
        if (state.user) {
            const firstName = state.user.name.split(' ')[0];
            accountBtn.innerHTML = `
                <div class="flex items-center gap-1.5 sm:gap-2">
                    ${state.user.photo ? `<img src="${state.user.photo}" class="w-6 h-6 rounded-full border border-gray-200 object-cover">` : `<i class="fa-regular fa-user text-xs md:text-sm text-black"></i>`}
                    <div id="mobile-profile-label" class="flex flex-col sm:hidden items-start leading-[1.0] text-left overflow-hidden transition-all duration-75 text-[9px] font-black uppercase tracking-wider text-gray-400 max-w-[80px]">
                        <span class="text-[7px] opacity-65">Cuenta</span>
                        <span class="text-[9px] text-black font-black truncate max-w-[60px]">${firstName}</span>
                    </div>
                </div>
                <div class="hidden sm:flex flex-col items-start leading-[1.1] text-left">
                    <span class="text-[9px] font-black uppercase tracking-wider text-gray-400">Hola, ${firstName}</span>
                    <span class="text-xs font-black text-black">Mi Cuenta</span>
                </div>
            `;
        } else {
            accountBtn.innerHTML = `
                <div class="flex items-center gap-1.5 sm:gap-2">
                    <i class="fa-regular fa-user text-xs md:text-sm text-black"></i>
                    <div id="mobile-profile-label" class="flex flex-col sm:hidden items-start leading-[1.0] text-left overflow-hidden transition-all duration-75 text-[9px] font-black uppercase tracking-wider text-gray-400 max-w-[80px]">
                        <span class="text-[7px] opacity-65">Hola</span>
                        <span class="text-[9px] text-black font-black truncate max-w-[60px]">Invitado</span>
                    </div>
                </div>
                <div class="hidden sm:flex flex-col items-start leading-[1.1] text-left">
                    <span class="text-[9px] font-black uppercase tracking-wider text-gray-400">Hola, Identifícate</span>
                    <span class="text-xs font-black text-black">Mi Cuenta</span>
                </div>
            `;
        }
    }

    if (dropdownContent) {
        if (state.user) {
            dropdownContent.innerHTML = `
                <div class="flex items-center gap-3 w-full pb-4 border-b border-gray-150 mb-4 text-left">
                    ${state.user.photo ? `<img src="${state.user.photo}" class="w-10 h-10 rounded-full object-cover border border-gray-100">` : `<div class="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center"><i class="fa-regular fa-user text-gray-400"></i></div>`}
                    <div class="text-left flex-1 min-w-0">
                        <p class="text-xs font-black text-black truncate">${state.user.name}</p>
                        <p class="text-[8px] font-bold text-gray-400 truncate">${state.user.email}</p>
                    </div>
                </div>
                <div class="flex flex-col gap-2 w-full mb-4 text-left">
                    <button onclick="window.navigateFromDropdown('orders')" class="flex items-center gap-2 text-[10px] font-bold text-gray-700 hover:text-black py-1.5 w-full text-left bg-transparent border-0 select-none cursor-pointer">
                        <i class="fa-solid fa-box text-xs text-gray-400"></i> Mis Pedidos
                    </button>
                    <button onclick="window.navigateFromDropdown('profile')" class="flex items-center gap-2 text-[10px] font-bold text-gray-700 hover:text-black py-1.5 w-full text-left bg-transparent border-0 select-none cursor-pointer">
                        <i class="fa-regular fa-user text-xs text-gray-400"></i> Mi Perfil
                    </button>
                </div>
                <button onclick="window.logout()" class="w-full border-2 border-black text-black py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-gray-50 transition-all select-none">
                    Cerrar Sesión
                </button>
            `;
        } else {
            dropdownContent.innerHTML = `
                <p class="text-[10px] font-bold text-gray-500 mb-3 uppercase tracking-wider leading-relaxed">Conéctate al instante para confirmar tus pedidos fácilmente.</p>
                <button onclick="window.openGoogleLogin()" class="w-full bg-black text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-900 transition-all flex items-center justify-center gap-2 shadow select-none active:scale-95">
                    <i class="fa-brands fa-google text-[10px]"></i> Iniciar sesión con Google
                </button>
            `;
        }
    }
}

function updateDepartmentUI() {
    const deptNav = document.getElementById('nav-selected-dept');
    const deptMob = document.getElementById('mobile-nav-selected-dept');
    if (deptNav) deptNav.innerText = state.selectedDepartment;
    if (deptMob) deptMob.innerText = state.selectedDepartment;
}

function showNotification(msg) {
    const container = document.getElementById('notification-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = "notification-toast";
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = "slideInNotify 0.4s ease-out reverse forwards";
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

// --- LISTENER DE AUTENTICACIÓN SUPABASE MOVIDO A LOADDATA ---

// --- SISTEMA DE RUTA Y NAVEGACIÓN CON HISTORIAL ---
function initRouter() {
    window.addEventListener('popstate', (e) => {
        const histState = e.state;
        if (histState) {
            state.view = histState.view || 'home';
            state.selectedCategory = histState.selectedCategory || 'todas';
            if (histState.productId) {
                state.selectedProduct = state.products.find(p => p.id == histState.productId);
                state.detailActiveImg = 0;
                startDetailAutoSlide();
            } else {
                state.selectedProduct = null;
                clearInterval(state.detailSlideInterval);
            }
            
            state.searchQuery = histState.searchQuery || '';
            const desktopSearch = document.getElementById('desktop-search-input');
            const mobileSearch = document.getElementById('mobile-search-input');
            if (desktopSearch) desktopSearch.value = state.searchQuery;
            if (mobileSearch) mobileSearch.value = state.searchQuery;

            render();
            updateHeaderUI();

            // Restaurar scroll con una micro-espera para permitir la renderización
            if (typeof histState.scrollY === 'number') {
                setTimeout(() => {
                    window.scrollTo({ top: histState.scrollY, behavior: 'instant' });
                }, 30);
            }
        } else {
            syncStateFromURL();
        }
    });

    updateAccountUI();
    updateDepartmentUI();

    syncStateFromURL(true);
}

function syncStateFromURL(isInitial = false) {
    const urlParams = new URLSearchParams(window.location.search);
    let view = urlParams.get('view') || 'home';
    const category = urlParams.get('category') || 'todas';
    const productId = urlParams.get('product');
    const search = urlParams.get('search') || '';

    if (category !== 'todas' && view === 'home') {
        view = 'catalog';
    }

    state.view = view;
    state.selectedCategory = category;
    state.searchQuery = search;
    
    const desktopSearch = document.getElementById('desktop-search-input');
    const mobileSearch = document.getElementById('mobile-search-input');
    if (desktopSearch) desktopSearch.value = search;
    if (mobileSearch) mobileSearch.value = search;

    if (productId) {
        state.selectedProduct = state.products.find(p => p.id == productId);
        state.detailActiveImg = 0;
        startDetailAutoSlide();
    } else {
        state.selectedProduct = null;
        clearInterval(state.detailSlideInterval);
    }

    render();
    updateHeaderUI();
    updateAccountUI();
    updateDepartmentUI();

    const scrollY = isInitial ? 0 : (history.state?.scrollY || 0);

    // Restaurar estado de modales
    if (urlParams.get('modal') === 'privacy') {
        setTimeout(() => window.showPrivacyPolicy(false), 100);
    } else {
        const modal = document.getElementById('privacy-policy-modal');
        if (modal && !modal.classList.contains('invisible')) {
            window.closePrivacyPolicy();
        }
    }

    if (isInitial) {
        history.replaceState({
            view: state.view,
            selectedCategory: state.selectedCategory,
            productId: productId || null,
            searchQuery: state.searchQuery,
            scrollY: window.scrollY
        }, "");
    } else {
        setTimeout(() => {
            window.scrollTo({ top: scrollY, behavior: 'instant' });
        }, 30);
    }
}

function updateHeaderUI() {
    const backBtn = document.getElementById('header-back-btn');
    if (backBtn) {
        if (state.view === 'detail') {
            backBtn.classList.remove('hidden');
        } else {
            backBtn.classList.add('hidden');
        }
    }

    // Actualizar estilos activos de pestañas de navegación
    const btnHome = document.getElementById('nav-btn-home');
    const btnCatalog = document.getElementById('nav-btn-catalog');

    if (btnHome) {
        if (state.view === 'home') {
            btnHome.classList.add('text-black');
            btnHome.classList.remove('text-gray-500');
        } else {
            btnHome.classList.remove('text-black');
            btnHome.classList.add('text-gray-500');
        }
    }
    if (btnCatalog) {
        if (state.view === 'catalog') {
            btnCatalog.classList.add('text-black');
            btnCatalog.classList.remove('text-gray-500');
        } else {
            btnCatalog.classList.remove('text-black');
            btnCatalog.classList.add('text-gray-500');
        }
    }

    // Actualizar estilos activos de pestañas móviles
    const mobileHome = document.getElementById('mobile-tab-home');
    const mobileCatalog = document.getElementById('mobile-tab-catalog');

    if (mobileHome) {
        if (state.view === 'home') {
            mobileHome.classList.add('text-black');
            mobileHome.classList.remove('text-gray-400');
        } else {
            mobileHome.classList.remove('text-black');
            mobileHome.classList.add('text-gray-400');
        }
    }
    if (mobileCatalog) {
        if (state.view === 'catalog') {
            mobileCatalog.classList.add('text-black');
            mobileCatalog.classList.remove('text-gray-400');
        } else {
            mobileCatalog.classList.remove('text-black');
            mobileCatalog.classList.add('text-gray-400');
        }
    }

    // Ejecutar transiciones de logo al actualizar UI de cabecera
    setTimeout(updateLogoTransition, 50);
}

function updateCatalogDropdown() {
    const dropdown = document.getElementById('catalog-dropdown');
    if (!dropdown) return;
    dropdown.innerHTML = `
        <button onclick="window.filterCategory('todas')" class="w-full text-left px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider text-gray-500 hover:bg-gray-50 hover:text-black transition-all flex items-center justify-between">
            Todas <i class="fa-solid fa-chevron-right text-[8px] opacity-40"></i>
        </button>
    ` + state.categories.map(c => `
        <button onclick="window.filterCategory(${c.id})" class="w-full text-left px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider text-gray-500 hover:bg-gray-50 hover:text-black transition-all flex items-center justify-between">
            ${c.name} <i class="fa-solid fa-chevron-right text-[8px] opacity-40"></i>
        </button>
    `).join('');
}

function updateLogoTransition() {
    // Sincronizar el header logo text y el logo de hero en móvil
    const headerLogoText = document.getElementById('header-logo-text');
    const headerLogoImg = document.getElementById('header-logo-img');
    const heroBrandingText = document.getElementById('hero-branding-text');
    const heroLogoImgMobile = document.getElementById('hero-logo-img-mobile');
    const descText = document.getElementById('hero-desc-text');
    const header = document.getElementById('main-header');
    
    const searchContainer = document.getElementById('mobile-header-search-container');
    const accountContainer = document.getElementById('account-menu-container');
    const mobileProfileLabel = document.getElementById('mobile-profile-label');
    const mobileSearchInput = document.getElementById('mobile-search-input-header');

    if (state.view !== 'home') {
        // Restaurar estado normal del logo y header en otras vistas
        if (headerLogoText) {
            headerLogoText.style.opacity = '1';
            headerLogoText.style.clipPath = '';
        }
        if (headerLogoImg) {
            headerLogoImg.style.opacity = '1';
            headerLogoImg.style.transform = '';
        }
        if (descText) {
            descText.style.transform = '';
        }
        if (header) {
            header.classList.remove('bg-transparent', 'border-transparent');
            header.classList.add('bg-white/80', 'backdrop-blur-xl', 'border-gray-50', 'shadow-sm');
        }
        if (searchContainer) {
            searchContainer.style.width = '36px';
            searchContainer.style.transform = '';
            searchContainer.style.position = '';
            searchContainer.style.left = '';
            searchContainer.style.top = '';
        }
        if (mobileSearchInput) {
            mobileSearchInput.style.opacity = '0';
        }
        if (accountContainer) {
            accountContainer.style.transform = '';
            accountContainer.style.position = '';
            accountContainer.style.left = '';
            accountContainer.style.top = '';
        }
        if (mobileProfileLabel) {
            mobileProfileLabel.style.opacity = '0';
            mobileProfileLabel.style.maxWidth = '0px';
        }
        return;
    }

    const scrollY = window.scrollY;
    const threshold = 150; // Distancia de scroll para completar la animación
    const progress = Math.min(scrollY / threshold, 1);

    // Desvanecer y escribir el texto del header logo hacia adentro (simulando escritura al bajar, y borrado al subir)
    if (headerLogoText) {
        headerLogoText.style.opacity = progress;
        const clipPercentage = 100 - (progress * 100);
        headerLogoText.style.clipPath = `inset(0 ${clipPercentage}% 0 0)`;
    }

    // Logo morphing transition
    if (heroLogoImgMobile) {
        if (progress < 0.99) {
            heroLogoImgMobile.style.opacity = '1';
            // Counteract scroll and scale down
            const scale = 1 - 0.58 * progress;
            // Adjust translation to align vertically with the header logo center
            const transY = scrollY - (52 * progress);
            heroLogoImgMobile.style.transform = `translateY(${transY}px) scale(${scale})`;
            heroLogoImgMobile.style.transformOrigin = 'left center';
            heroLogoImgMobile.style.zIndex = '50';
        } else {
            heroLogoImgMobile.style.opacity = '0';
        }
    }

    if (headerLogoImg) {
        headerLogoImg.style.opacity = progress >= 0.99 ? '1' : '0';
    }

    // Animate search container width and opacity on scroll progress (0.2 to 0.8)
    const p_search = Math.max(0, Math.min((progress - 0.2) / 0.6, 1));
    const p_profile = Math.min(progress / 0.5, 1);
    
    // Animate translations (slide search and profile to the left when at scroll = 0)
    if (searchContainer && accountContainer && window.innerWidth < 1280) { // Only on mobile/tablet viewports
        const W = window.innerWidth;
        const padding = W >= 640 ? 24 : 16;
        const gap = W >= 768 ? 16 : 8;
        const cartW = 40;
        
        let startSearch = W >= 640 ? 170 : 130;
        
        // Calculate dynamic profile label text width
        let textWidth = 48; // Default for "Invitado"
        if (state.user && state.user.name) {
            const firstName = state.user.name.split(' ')[0];
            textWidth = Math.max(30, Math.min(60, firstName.length * 8));
        }
        let startAccount = 54 + textWidth; // ~102px for Guest
        
        // Dynamically cap startSearch and startAccount on narrow screens to prevent overflow
        const maxAvailableForTwo = W - padding - padding - cartW - gap - gap;
        if (startSearch + startAccount > maxAvailableForTwo) {
            const overflow = (startSearch + startAccount) - maxAvailableForTwo;
            startSearch = Math.max(90, startSearch - overflow * 0.6);
            startAccount = Math.max(80, startAccount - overflow * 0.4);
        }
        
        const currentSearchW = startSearch - (startSearch - 36) * p_search;
        const currentAccountW = startAccount - (startAccount - 36) * p_profile;
        
        // Fast fade-outs for text content to prevent clipped overlaps
        const p_profile_fade = Math.min(progress / 0.2, 1);
        const p_search_fade = Math.max(0, Math.min((progress - 0.2) / 0.3, 1));
        
        // Apply absolute positioning styles to bypass standard flex layout flow
        searchContainer.style.position = 'absolute';
        searchContainer.style.left = '0px';
        searchContainer.style.top = '50%';
        
        accountContainer.style.position = 'absolute';
        accountContainer.style.left = '0px';
        accountContainer.style.top = '50%';
        
        // Apply widths
        searchContainer.style.width = `${currentSearchW}px`;
        if (mobileSearchInput) {
            mobileSearchInput.style.opacity = 1 - p_search_fade;
        }
        if (mobileProfileLabel) {
            mobileProfileLabel.style.opacity = 1 - p_profile_fade;
            mobileProfileLabel.style.maxWidth = `${Math.max(0, currentAccountW - 36)}px`;
        }
        
        // Target positions in absolute coordinates
        const cartLeft = W - padding - cartW;
        const unTransAccountLeft1 = cartLeft - gap - 36;
        const unTransSearchLeft1 = unTransAccountLeft1 - gap - 36;
        
        const targetSearchLeft = padding * (1 - progress) + unTransSearchLeft1 * progress;
        const targetAccountLeft = (padding + currentSearchW + gap) * (1 - progress) + unTransAccountLeft1 * progress;
        
        searchContainer.style.transform = `translateY(-50%) translateX(${targetSearchLeft}px)`;
        accountContainer.style.transform = `translateY(-50%) translateX(${targetAccountLeft}px)`;
    } else {
        if (searchContainer) {
            searchContainer.style.width = '';
            searchContainer.style.transform = '';
            searchContainer.style.position = '';
            searchContainer.style.left = '';
            searchContainer.style.top = '';
        }
        if (mobileSearchInput) {
            mobileSearchInput.style.opacity = '';
        }
        if (accountContainer) {
            accountContainer.style.transform = '';
            accountContainer.style.position = '';
            accountContainer.style.left = '';
            accountContainer.style.top = '';
        }
        if (mobileProfileLabel) {
            mobileProfileLabel.style.opacity = '';
            mobileProfileLabel.style.maxWidth = '';
        }
    }

    // Desvanecer texto gigante del hero hacia afuera (fade-out) y desplazarlo hacia arriba
    if (heroBrandingText) {
        heroBrandingText.style.opacity = 1 - progress;
        heroBrandingText.style.transform = `translateY(${-50 * progress}px)`;
    }

    // Desplazar párrafo descriptivo hacia arriba para ocupar el lugar reajustado
    if (descText) {
        const maxTranslateY = window.innerWidth < 768 ? -80 : -130;
        const currentTranslateY = maxTranslateY * progress;
        descText.style.transform = `translateY(${currentTranslateY}px)`;
    }

    // Manejar color de fondo y bordes del header
    if (header) {
        if (progress < 0.1) {
            header.classList.remove('bg-white/80', 'backdrop-blur-xl', 'border-gray-50', 'shadow-sm');
            header.classList.add('bg-transparent', 'border-transparent');
        } else {
            header.classList.remove('bg-transparent', 'border-transparent');
            header.classList.add('bg-white/80', 'backdrop-blur-xl', 'border-gray-50', 'shadow-sm');
        }
    }
}

window.handleMobileSearchClick = (e) => {
    const container = document.getElementById('mobile-header-search-container');
    if (container && container.style.width === '36px') {
        // Scrolled down, let's scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const input = document.getElementById('mobile-search-input-header');
        if (input) {
            setTimeout(() => input.focus(), 300);
        }
    }
};

// Escuchadores de eventos para la animación del logo
window.addEventListener('scroll', updateLogoTransition, { passive: true });
window.addEventListener('resize', updateLogoTransition, { passive: true });

window.navigate = (view, id = null) => {
    if (history.state) {
        history.replaceState({
            ...history.state,
            scrollY: window.scrollY
        }, "");
    }

    state.view = view;
    state.searchQuery = '';
    const desktopSearch = document.getElementById('desktop-search-input');
    const mobileSearch = document.getElementById('mobile-search-input');
    if (desktopSearch) desktopSearch.value = '';
    if (mobileSearch) mobileSearch.value = '';
    
    // Ocultar buscador móvil al navegar
    const mobileSearchBar = document.getElementById('mobile-search-bar');
    if (mobileSearchBar) mobileSearchBar.classList.add('hidden');

    if (id) {
        state.selectedProduct = state.products.find(p => p.id == id);
        state.detailActiveImg = 0;
        startDetailAutoSlide();
    } else {
        clearInterval(state.detailSlideInterval);
    }

    const params = new URLSearchParams();
    params.set('view', view);
    if (view === 'detail' && id) {
        params.set('product', id);
    } else if (state.selectedCategory !== 'todas') {
        params.set('category', state.selectedCategory);
    }

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    history.pushState({
        view: view,
        selectedCategory: state.selectedCategory,
        productId: id || null,
        searchQuery: '',
        scrollY: 0
    }, "", newUrl);

    render();
    updateHeaderUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.filterCategory = (id) => {
    if (history.state) {
        history.replaceState({
            ...history.state,
            scrollY: window.scrollY
        }, "");
    }

    state.selectedCategory = id;
    state.view = 'catalog';
    
    const params = new URLSearchParams();
    params.set('view', 'catalog');
    if (id !== 'todas') {
        params.set('category', id);
    }
    if (state.searchQuery) {
        params.set('search', state.searchQuery);
    }

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    history.pushState({
        view: 'catalog',
        selectedCategory: id,
        productId: null,
        searchQuery: state.searchQuery,
        scrollY: 0
    }, "", newUrl);

    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.goBack = () => {
    if (window.history.state && window.history.length > 1) {
        window.history.back();
    } else {
        window.navigate('home');
    }
};

window.handleSearch = (query) => {
    state.searchQuery = query.toLowerCase().trim();
    
    const desktopSearch = document.getElementById('desktop-search-input');
    const mobileSearch = document.getElementById('mobile-search-input');
    if (desktopSearch && desktopSearch.value !== query) desktopSearch.value = query;
    if (mobileSearch && mobileSearch.value !== query) mobileSearch.value = query;

    const params = new URLSearchParams(window.location.search);
    if (query) {
        params.set('search', query);
        if (state.view === 'home') {
            state.view = 'catalog';
            params.set('view', 'catalog');
        }
    } else {
        params.delete('search');
    }
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    
    history.replaceState({
        ...history.state,
        view: state.view,
        searchQuery: query,
        scrollY: window.scrollY
    }, "", newUrl);

    render();
    updateHeaderUI();
};

window.toggleMobileSearch = () => {
    const searchBar = document.getElementById('mobile-search-bar');
    const searchInput = document.getElementById('mobile-search-input');
    if (searchBar) {
        const isHidden = searchBar.classList.contains('hidden');
        if (isHidden) {
            searchBar.classList.remove('hidden');
            if (searchInput) searchInput.focus();
        } else {
            searchBar.classList.add('hidden');
        }
    }
};

function updateSEOTags() {
    let title = "Emma Store";
    let desc = "Emma Store Bolivia - La mejor tienda de accesorios, relojes y tecnología con envíos a todo el país";
    let img = "https://emmastore.qzz.io/assets/logo.png";
    let url = window.location.href;

    if (state.view === 'detail' && state.selectedProduct) {
        title = `${state.selectedProduct.name} - Emma Store`;
        desc = state.selectedProduct.description || desc;
        if (state.selectedProduct.images && state.selectedProduct.images.length > 0) {
            img = state.selectedProduct.images[0];
        }
    } else if (state.view === 'checkout') {
        title = "Checkout - Emma Store";
    }

    // Actualizar document title
    document.title = title;

    // Actualizar meta description
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.content = desc;

    // Actualizar Open Graph
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.content = title;
    
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.content = desc;
    
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage) ogImage.content = img;
    
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.content = url;

    // Actualizar Twitter Cards
    const twTitle = document.querySelector('meta[name="twitter:title"]');
    if (twTitle) twTitle.content = title;

    // Actualizar o crear Canonical Tag
    let canonicalTag = document.querySelector('link[rel="canonical"]');
    if (!canonicalTag) {
        canonicalTag = document.createElement('link');
        canonicalTag.rel = 'canonical';
        document.head.appendChild(canonicalTag);
    }
    try {
        const canonicalUrlObj = new URL(url);
        canonicalUrlObj.searchParams.delete('modal'); // Limpiar params innecesarios
        canonicalTag.href = canonicalUrlObj.toString();
    } catch (e) {
        canonicalTag.href = url;
    }
    const twDesc = document.querySelector('meta[name="twitter:description"]');
    if (twDesc) twDesc.content = desc;
    
    const twImage = document.querySelector('meta[name="twitter:image"]');
    if (twImage) twImage.content = img;
}

function render() {
    updateSEOTags();
    const main = document.getElementById('main-view');
    if(!main) return;
    main.innerHTML = '';
    
    // Limpiar intervalos de los carruseles al salir de Inicio
    if (state.view !== 'home') {
        if (window.randomCatCarouselInterval) {
            clearInterval(window.randomCatCarouselInterval);
            window.randomCatCarouselInterval = null;
        }
        if (window.spotlightCarouselInterval) {
            clearInterval(window.spotlightCarouselInterval);
            window.spotlightCarouselInterval = null;
        }
        if (window.heroSliderInterval) {
            clearInterval(window.heroSliderInterval);
            window.heroSliderInterval = null;
        }
        if (window.heroPromoTimerInterval) {
            clearInterval(window.heroPromoTimerInterval);
            window.heroPromoTimerInterval = null;
        }
    }
    
    // Ocultar buscador móvil en vistas secundarias (que no sean home o catalog)
    const mobileSearchBar = document.getElementById('mobile-search-bar');
    if (mobileSearchBar) {
        if (state.view === 'home' || state.view === 'catalog') {
            // No hacer nada, dejar que mantenga su estado visible/oculto
        } else {
            mobileSearchBar.classList.add('hidden');
        }
    }

    if (state.view === 'home') {
        renderHero(main);
        renderBenefits(main);
        renderRandomProductSpotlight(main);
        renderRandomCategoryCarousel(main);
        renderTestimonials(main);
        renderFAQ(main);
        initParallaxScroll();
    } else if (state.view === 'catalog') {
        renderSubmenu(main);
        renderCatalog(main);
    } else if (state.view === 'detail') {
        renderDetail(main);
    } else if (state.view === 'checkout') {
        renderCheckout(main);
    } else if (state.view === 'profile') {
        renderProfile(main);
    } else if (state.view === 'orders') {
        renderOrders(main);
    }
}

// --- UTILIDADES ---
// Función auxiliar para extraer características de la descripción del producto
window.getProductFeatures = function(p) {
    if (!p.description) return [];
    let items = [];
    if (p.description.includes('✓')) {
        items = p.description.split('✓').map(s => s.trim());
    } else if (p.description.includes('\n')) {
        items = p.description.split('\n').map(s => s.trim());
    } else if (p.description.includes('-')) {
        items = p.description.split('-').map(s => s.trim());
    } else {
        items = p.description.split('.').map(s => s.trim());
    }
    return items.filter(s => s.length > 5 && !s.toLowerCase().includes('http')).slice(0, 3);
};

function initRevealAnimations() {
    setTimeout(function() {
        var selectors = '.reveal-up, .reveal-left, .reveal-right, .reveal-scale, .reveal-up-d1, .reveal-up-d2, .reveal-up-d3, .reveal-up-d4';
        var elements = document.querySelectorAll(selectors);
        
        if ('IntersectionObserver' in window) {
            var observer = new IntersectionObserver(function(entries) {
                for (var i = 0; i < entries.length; i++) {
                    if (entries[i].isIntersecting) {
                        entries[i].target.classList.add('active');
                    }
                }
            }, { threshold: 0.05 });
            
            for (var i = 0; i < elements.length; i++) {
                observer.observe(elements[i]);
            }
        } else {
            // Fallback: just show everything
            for (var i = 0; i < elements.length; i++) {
                elements[i].classList.add('active');
            }
        }
    }, 100);
}

// Parallax scroll effect for floating elements
function initParallaxScroll() {
    var floatElements = document.querySelectorAll('.parallax-float');
    if (floatElements.length === 0) return;
    
    function onScroll() {
        var scrollY = window.pageYOffset || document.documentElement.scrollTop;
        for (var i = 0; i < floatElements.length; i++) {
            var el = floatElements[i];
            var speed = parseFloat(el.getAttribute('data-speed')) || 0.05;
            var rect = el.getBoundingClientRect();
            var offset = (rect.top + rect.height / 2 - window.innerHeight / 2) * speed;
            el.style.transform = 'translateY(' + offset + 'px)';
        }
    }
    
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
}

// FAQ toggle
window.toggleFaq = function(el) {
    el.classList.toggle('open');
};

// --- VISTAS ESPECÍFICAS ---
function renderHero(container) {
    // Filter active promotions
    const activePromotions = (state.promotions || []).filter(p => p.endsAt > Date.now());
    
    // Fallback: standard product slider
    let heroImages = [];
    if (state.products && state.products.length > 0) {
        const shuffled = [...state.products].sort(() => 0.5 - Math.random());
        heroImages = shuffled.slice(0, 5).map(p => p.images ? p.images[0] : null).filter(img => img);
    }
    if (heroImages.length === 0) {
        heroImages = [
            "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&q=80&w=800",
            "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&q=80&w=800"
        ];
    }

    let heroRightHTML = '';
    if (activePromotions.length > 0) {
        heroRightHTML = `
            <div class="hero-image-container shadow-2xl glass-effect p-2 cursor-pointer transition-transform hover:scale-[1.01]" id="hero-promo-slider">
                <div class="w-full h-full rounded-2xl overflow-hidden relative">
                    ${activePromotions.map((promo, i) => `
                        <div class="hero-image absolute inset-0 transition-opacity duration-1000 flex flex-col justify-between ${i === 0 ? 'active' : 'opacity-0'}" onclick="window.viewPromotion(${promo.id})">
                            <img src="${promo.images[0]}" class="w-full h-full object-cover" alt="${promo.name}">
                            <!-- Badge of countdown overlay -->
                            <div class="absolute bottom-4 left-4 bg-black/70 backdrop-blur-md text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-2 border border-white/15">
                                <span class="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping"></span>
                                <span>PROMO: Vence en <span class="promo-timer" data-ends="${promo.endsAt}">${formatCountdown(promo.endsAt)}</span></span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } else {
        heroRightHTML = `
            <div class="hero-image-container shadow-2xl glass-effect p-2">
                <div class="w-full h-full rounded-2xl overflow-hidden relative" id="hero-image-slider">
                    ${heroImages.map((img, i) => `
                        <img src="${img}" class="hero-image ${i === 0 ? 'active' : ''}" alt="Tech Image ${i}">
                    `).join('')}
                </div>
            </div>
        `;
    }

    const heroDiv = document.createElement('div');
    heroDiv.className = "max-w-7xl mx-auto px-6 pt-4 lg:pt-0 pb-6 animate-fade";
    heroDiv.innerHTML = `
        <div class="flex flex-col lg:flex-row gap-8 items-start lg:items-center justify-between mb-12">
            
            <!-- Columna Izquierda: Texto y Botones -->
            <div class="w-full lg:w-1/2 flex flex-col items-start text-left reveal-up lg:-mt-12">
                
                <div class="inline-flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-full border border-gray-100 shadow-sm mb-8 animate-float self-start">
                    <span class="text-[10px] md:text-xs">✨</span>
                    <span class="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-gray-500">Tecnología que transforma tu día a día</span>
                </div>

                <!-- Texto de branding gigante del Hero con animación typewriter -->
                <div id="hero-branding-text" class="mb-6 flex flex-col leading-[0.95] select-none transition-all duration-75 ease-out w-full items-start">
                    <!-- Contenedor para PC: EMMA Store (Emma en Extrabold, Store en Light) -->
                    <div class="hidden md:flex flex-col items-start">
                        <span class="text-4xl sm:text-6xl md:text-7xl lg:text-8xl text-black cinematic-text w-fit leading-none py-1">
                            <span class="font-extrabold tracking-tighter uppercase">EMMA</span>
                            <span class="font-light tracking-tight ml-2 uppercase">Store</span>
                        </span>
                        <span class="text-[12px] sm:text-[16px] md:text-[20px] font-bold uppercase tracking-widest opacity-40 mt-3 cinematic-subtext">Bolivia</span>
                    </div>
                    <!-- Contenedor para Móvil: Logo a la izquierda, textos a la derecha -->
                    <div class="flex items-center gap-5 md:hidden justify-start w-full">
                        <!-- Logo con doble animación: entrada cinemática + flotación -->
                        <div class="cinematic-logo-mobile flex-shrink-0">
                            <span id="hero-logo-img-mobile" class="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center text-white emma-floating-logo hero-logo-glow">
                                <img src="assets/logo.png" alt="Logo Emma Store" class="w-full h-full object-cover rounded-full">
                            </span>
                        </div>
                        <!-- Stack de textos -->
                        <div class="flex flex-col items-start leading-[0.95] text-left">
                            <span class="text-5xl font-extrabold uppercase tracking-tighter text-black cinematic-text-m1 w-fit">EMMA</span>
                            <span class="text-3xl font-light uppercase tracking-[0.15em] text-black mt-1 cinematic-text-m2 w-fit">Store</span>
                            <span class="text-[10px] font-bold uppercase tracking-[0.25em] opacity-40 mt-2 cinematic-text-m3 w-fit">Bolivia</span>
                        </div>
                    </div>
                </div>

                <!-- A medida que sube, el texto descriptivo se va acomodando en lugar del título -->
                <p id="hero-desc-text" class="text-xs sm:text-sm md:text-base text-gray-500 font-medium leading-relaxed mb-8 max-w-lg text-left transition-transform duration-75 ease-out">
                    Explora nuestro catálogo exclusivo, arma tu carrito y coordina la entrega de forma rápida y segura sin salir de casa. Directo a tu WhatsApp.
                </p>
                
                <div class="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                    <button onclick="window.navigate('catalog')" class="btn-premium pulse-green bg-green-500 hover:bg-green-600 text-white px-12 py-6 rounded-2xl text-sm sm:text-base font-black uppercase tracking-widest shadow-xl hover:shadow-2xl active:scale-95 flex items-center justify-center gap-3 w-full sm:w-auto">
                        <i class="fa-solid fa-bag-shopping text-lg"></i> Ver Catálogo Completo <i class="fa-solid fa-arrow-right text-lg"></i>
                    </button>
                </div>
            </div>

            <!-- Columna Derecha: Imagen o Promoción -->
            <div class="w-full lg:w-1/2 h-[300px] sm:h-[400px] lg:h-[500px] reveal-up" style="transition-delay: 0.2s">
                ${heroRightHTML}
            </div>
            
        </div>

        <!-- Barra Inferior de Beneficios -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-8 reveal-up" style="transition-delay: 0.4s">
            <div class="glass-effect rounded-2xl p-6 flex items-center gap-4 transition-transform hover:-translate-y-1">
                <div class="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center text-orange-500 text-xl flex-shrink-0">
                    <i class="fa-solid fa-bolt"></i>
                </div>
                <div>
                    <h4 class="text-xs font-black uppercase tracking-wider text-black">Envío súper veloz en el día</h4>
                    <p class="text-[10px] text-gray-400 font-bold mt-1">Recibe tus compras en tiempo récord.</p>
                </div>
            </div>
            <div class="glass-effect rounded-2xl p-6 flex items-center gap-4 transition-transform hover:-translate-y-1">
                <div class="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-500 text-xl flex-shrink-0">
                    <i class="fa-solid fa-lock"></i>
                </div>
                <div>
                    <h4 class="text-xs font-black uppercase tracking-wider text-black">Pagos seguros contra entrega</h4>
                    <p class="text-[10px] text-gray-400 font-bold mt-1">Paga al recibir tu pedido en la puerta de tu casa.</p>
                </div>
            </div>
        </div>
    `;

    container.appendChild(heroDiv);

    // Inicializar carruseles
    if (activePromotions.length > 1) {
        let currentPromo = 0;
        const images = heroDiv.querySelectorAll('.hero-image');
        clearInterval(window.heroSliderInterval);
        window.heroSliderInterval = setInterval(() => {
            if (!document.getElementById('hero-promo-slider')) {
                clearInterval(window.heroSliderInterval);
                return;
            }
            images[currentPromo].classList.remove('active');
            images[currentPromo].classList.add('opacity-0');
            currentPromo = (currentPromo + 1) % images.length;
            images[currentPromo].classList.add('active');
            images[currentPromo].classList.remove('opacity-0');
        }, 5000);
    } else if (activePromotions.length === 0 && heroImages.length > 1) {
        let currentImg = 0;
        const images = heroDiv.querySelectorAll('.hero-image');
        clearInterval(window.heroSliderInterval);
        window.heroSliderInterval = setInterval(() => {
            if (!document.getElementById('hero-image-slider')) {
                clearInterval(window.heroSliderInterval);
                return;
            }
            images[currentImg].classList.remove('active');
            currentImg = (currentImg + 1) % images.length;
            images[currentImg].classList.add('active');
        }, 5000);
    }

    // Dynamic timer countdown update on hero
    clearInterval(window.heroPromoTimerInterval);
    if (activePromotions.length > 0) {
        window.heroPromoTimerInterval = setInterval(() => {
            const timers = document.querySelectorAll('.promo-timer');
            if (timers.length === 0) {
                clearInterval(window.heroPromoTimerInterval);
                return;
            }
            timers.forEach(t => {
                const endsAt = parseInt(t.getAttribute('data-ends'));
                t.innerText = formatCountdown(endsAt);
            });
        }, 1000);
    }
}

// --- VISTAS ESPECÍFICAS ---

// ===== SECCIÓN: BENEFICIOS DE COMPRAR EN EMMA STORE =====
function renderBenefits(container) {
    var div = document.createElement('div');
    div.className = 'section-divider py-16 md:py-24';
    div.innerHTML = `
        <div class="max-w-7xl mx-auto px-6">
            <div class="text-center mb-12 md:mb-16">
                <p class="text-[10px] md:text-xs font-black uppercase tracking-[0.4em] text-gray-400 mb-3 reveal-up">¿Por qué elegirnos?</p>
                <h2 class="text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-tighter text-black leading-[0.95] reveal-up text-shimmer">
                    Beneficios de comprar<br>en Emma Store
                </h2>
            </div>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div onclick="window.open('https://wa.me/' + window.getDefaultContactNumber() + '?text=Hola%20Emma%20Store,%20necesito%20atenci%C3%B3n%20personalizada%20con%20un%20asesor', '_blank')" class="benefit-card reveal-up-d1 cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-all">
                    <div class="benefit-icon bg-green-50 text-green-500">
                        <i class="fa-brands fa-whatsapp"></i>
                    </div>
                    <h4 class="text-xs font-black uppercase tracking-wider text-black mb-2">Atención Personalizada</h4>
                    <p class="text-[11px] text-gray-500 leading-relaxed font-medium">Haz tu pedido y coordina directamente con un asesor por WhatsApp. Respuesta rápida garantizada.</p>
                </div>
                
                <div class="benefit-card reveal-up-d2">
                    <div class="benefit-icon bg-blue-50 text-blue-500">
                        <i class="fa-solid fa-truck-fast"></i>
                    </div>
                    <h4 class="text-xs font-black uppercase tracking-wider text-black mb-2">Envíos Rápidos y Seguros</h4>
                    <p class="text-[11px] text-gray-500 leading-relaxed font-medium">Envíos garantizados hasta la puerta de tu casa o punto de entrega en todo Bolivia.</p>
                </div>
                
                <div class="benefit-card reveal-up-d3">
                    <div class="benefit-icon bg-purple-50 text-purple-500">
                        <i class="fa-solid fa-hand-holding-heart"></i>
                    </div>
                    <h4 class="text-xs font-black uppercase tracking-wider text-black mb-2">Sin Complicaciones</h4>
                    <p class="text-[11px] text-gray-500 leading-relaxed font-medium">Sin registros aburridos ni tarjetas obligatorias. Eliges, pides y coordinas el pago como prefieras.</p>
                </div>
                
                <div class="benefit-card reveal-up-d4">
                    <div class="benefit-icon bg-orange-50 text-orange-500">
                        <i class="fa-solid fa-shield-halved"></i>
                    </div>
                    <h4 class="text-xs font-black uppercase tracking-wider text-black mb-2">Garantía de Satisfacción</h4>
                    <p class="text-[11px] text-gray-500 leading-relaxed font-medium">Si tu producto tiene fallas de fábrica, gestionamos el cambio inmediato. Tu confianza es nuestra prioridad.</p>
                </div>
            </div>
            
            <!-- Logo flotante decorativo -->
            <div class="flex justify-center mt-12 md:mt-16">
                <div class="emma-floating-logo parallax-float" data-speed="0.08">
                    <div class="w-16 h-16 md:w-20 md:h-20 rounded-2xl overflow-hidden bg-white border border-gray-100 shadow-lg p-2">
                        <img src="assets/logo.png" alt="Emma Store" class="w-full h-full object-contain">
                    </div>
                </div>
            </div>
        </div>
    `;
    container.appendChild(div);
    initRevealAnimations();
}

// ===== SECCIÓN: CÓMO FUNCIONA EL PEDIDO =====
function renderHowItWorks(container) {
    var div = document.createElement('div');
    div.className = 'section-divider py-16 md:py-24';
    div.innerHTML = `
        <div class="max-w-5xl mx-auto px-6">
            <div class="text-center mb-14 md:mb-20">
                <p class="text-[10px] md:text-xs font-black uppercase tracking-[0.4em] text-gray-400 mb-3 reveal-up">Súper fácil</p>
                <h2 class="text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-tighter text-black leading-[0.95] reveal-up text-shimmer">
                    ¿Cómo hacer tu pedido?
                </h2>
                <p class="text-sm text-gray-500 font-medium mt-4 max-w-lg mx-auto reveal-up">En 3 simples pasos recibes tu producto en la puerta de tu casa</p>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-16 relative">
                <div class="step-card text-center reveal-up-d1">
                    <div class="step-number">1</div>
                    <div class="w-14 h-14 rounded-2xl bg-blue-50 text-blue-500 flex items-center justify-center text-2xl mx-auto mb-5">
                        <i class="fa-solid fa-cart-shopping"></i>
                    </div>
                    <h4 class="text-sm font-black uppercase tracking-wider text-black mb-2">Arma tu Carrito</h4>
                    <p class="text-[11px] text-gray-500 leading-relaxed font-medium">Explora nuestro catálogo y elige los productos que más te gusten. Añádelos a tu bolsa con un solo clic.</p>
                    <div class="step-connector"></div>
                </div>
                
                <div class="step-card text-center reveal-up-d2">
                    <div class="step-number">2</div>
                    <div class="w-14 h-14 rounded-2xl bg-green-50 text-green-500 flex items-center justify-center text-2xl mx-auto mb-5">
                        <i class="fa-brands fa-whatsapp"></i>
                    </div>
                    <h4 class="text-sm font-black uppercase tracking-wider text-black mb-2">Envía tu Pedido</h4>
                    <p class="text-[11px] text-gray-500 leading-relaxed font-medium">Haz clic en "Enviar" y se generará un mensaje automático con tu lista directo a nuestro WhatsApp.</p>
                    <div class="step-connector"></div>
                </div>
                
                <div class="step-card text-center reveal-up-d3">
                    <div class="step-number">3</div>
                    <div class="w-14 h-14 rounded-2xl bg-orange-50 text-orange-500 flex items-center justify-center text-2xl mx-auto mb-5">
                        <i class="fa-solid fa-box-open"></i>
                    </div>
                    <h4 class="text-sm font-black uppercase tracking-wider text-black mb-2">Coordina y Recibe</h4>
                    <p class="text-[11px] text-gray-500 leading-relaxed font-medium">Un asesor confirmará tu stock, acordarán el método de pago y programarán la entrega. ¡Así de fácil!</p>
                </div>
            </div>
            
            <!-- CTA verde llamativo -->
            <div class="text-center mt-12 md:mt-16 reveal-scale">
                <button onclick="window.navigate('catalog')" 
                        class="btn-premium pulse-green bg-green-500 hover:bg-green-600 text-white px-10 py-5 rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl hover:shadow-2xl active:scale-95 inline-flex items-center gap-3 transition-all">
                    <i class="fa-solid fa-bag-shopping"></i> Ver Catálogo Completo <i class="fa-solid fa-arrow-right"></i>
                </button>
            </div>
        </div>
    `;
    container.appendChild(div);
    initRevealAnimations();
}

// ===== SECCIÓN: TESTIMONIOS / PRUEBA SOCIAL =====
function renderTestimonials(container) {
    var div = document.createElement('div');
    div.className = 'py-16 md:py-24 bg-white';
    div.innerHTML = `
        <div class="max-w-6xl mx-auto px-6">
            <div class="text-center mb-12 md:mb-16">
                <p class="text-[10px] md:text-xs font-black uppercase tracking-[0.4em] text-gray-400 mb-3 reveal-up">Prueba social</p>
                <h2 class="text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-tighter text-black leading-[0.95] reveal-up text-shimmer">
                    Lo que dicen<br>nuestros clientes
                </h2>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="testimonial-card reveal-up-d1">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white text-sm font-black">M</div>
                        <div>
                            <p class="text-xs font-black text-black">María G.</p>
                            <p class="text-[9px] text-gray-400 font-bold">Cochabamba</p>
                        </div>
                        <div class="ml-auto text-green-500"><i class="fa-brands fa-whatsapp text-lg"></i></div>
                    </div>
                    <div class="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                        <p class="text-xs text-gray-600 leading-relaxed font-medium italic">"Ya me llegó el producto, excelente calidad y súper rápido el envío. La atención por WhatsApp fue increíble, me respondieron al instante. ¡100% recomendado!"</p>
                    </div>
                    <div class="flex gap-1 mt-3">
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                    </div>
                </div>
                
                <div class="testimonial-card reveal-up-d2">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-cyan-500 flex items-center justify-center text-white text-sm font-black">C</div>
                        <div>
                            <p class="text-xs font-black text-black">Carlos R.</p>
                            <p class="text-[9px] text-gray-400 font-bold">Santa Cruz</p>
                        </div>
                        <div class="ml-auto text-green-500"><i class="fa-brands fa-whatsapp text-lg"></i></div>
                    </div>
                    <div class="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                        <p class="text-xs text-gray-600 leading-relaxed font-medium italic">"Pedí una selladora y una plancha para ropa. Todo llegó perfecto y bien empacado. El pago contra entrega me dio mucha confianza. Volveré a comprar seguro."</p>
                    </div>
                    <div class="flex gap-1 mt-3">
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                    </div>
                </div>
                
                <div class="testimonial-card reveal-up-d3">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white text-sm font-black">L</div>
                        <div>
                            <p class="text-xs font-black text-black">Laura P.</p>
                            <p class="text-[9px] text-gray-400 font-bold">La Paz</p>
                        </div>
                        <div class="ml-auto text-green-500"><i class="fa-brands fa-whatsapp text-lg"></i></div>
                    </div>
                    <div class="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                        <p class="text-xs text-gray-600 leading-relaxed font-medium italic">"Me encanta que no hay que registrarse ni poner tarjetas. Simplemente eliges, mandas por WhatsApp y listo. Los productos son de muy buena calidad para el precio."</p>
                    </div>
                    <div class="flex gap-1 mt-3">
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                        <i class="fa-regular fa-star text-yellow-400 text-xs"></i>
                    </div>
                </div>
            </div>
            

        </div>
    `;
    container.appendChild(div);
    initRevealAnimations();
}

// ===== SECCIÓN: PREGUNTAS FRECUENTES =====
function renderFAQ(container) {
    var faqs = [
        { q: '¿Tienen tienda física o solo virtual?', a: 'Emma Store es una tienda 100% virtual. Operamos a través de nuestro catálogo en línea y coordinamos todos los pedidos por WhatsApp para brindarte la mejor atención personalizada desde la comodidad de tu hogar.' },
        { q: '¿Cuáles son los métodos de pago?', a: 'Aceptamos efectivo contra entrega, transferencia bancaria, pagos por QR (Tigo Money, etc.). ¡Tú eliges cómo pagar! No necesitas tarjeta de crédito ni débito obligatoriamente.' },
        { q: '¿Cuánto tarda en llegar mi pedido?', a: 'En la ciudad de origen, los envíos se realizan el mismo día o al día siguiente. Para otras ciudades de Bolivia, el tiempo estimado es de 2 a 5 días hábiles dependiendo de la ubicación.' },
        { q: '¿Hacen envíos a todo Bolivia?', a: '¡Sí! Realizamos envíos a todos los departamentos de Bolivia. Cochabamba, Santa Cruz, La Paz, Sucre, Oruro, Potosí, Tarija, Beni y Pando. Coordinamos la logística para que tu pedido llegue seguro.' },
        { q: '¿Qué pasa si mi producto llega con defectos?', a: 'Contamos con garantía de satisfacción. Si tu producto presenta fallas de fábrica, contáctanos por WhatsApp y gestionaremos el cambio inmediato sin costo adicional para ti.' },
        { q: '¿Puedo ver los productos antes de comprar?', a: 'Todos nuestros productos cuentan con fotos reales y detalladas en el catálogo. Además, puedes solicitar fotos o videos adicionales por WhatsApp antes de confirmar tu pedido.' }
    ];
    
    var div = document.createElement('div');
    div.className = 'section-divider py-16 md:py-24';
    div.innerHTML = `
        <div class="max-w-3xl mx-auto px-6">
            <div class="text-center mb-12 md:mb-16">
                <p class="text-[10px] md:text-xs font-black uppercase tracking-[0.4em] text-gray-400 mb-3 reveal-up">Resolvemos tus dudas</p>
                <h2 class="text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-tighter text-black leading-[0.95] reveal-up text-shimmer">
                    Preguntas Frecuentes
                </h2>
            </div>
            
            <div class="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden reveal-up">
                ${faqs.map(function(faq, i) {
                    return '<div class="faq-item px-6 md:px-8 py-5" onclick="window.toggleFaq(this)">' +
                        '<div class="flex items-center justify-between gap-4">' +
                            '<h4 class="text-xs md:text-sm font-black text-black uppercase tracking-wider">' + faq.q + '</h4>' +
                            '<i class="fa-solid fa-chevron-down faq-chevron text-xs text-gray-400 flex-shrink-0"></i>' +
                        '</div>' +
                        '<div class="faq-answer">' +
                            '<p class="text-xs text-gray-500 leading-relaxed font-medium">' + faq.a + '</p>' +
                        '</div>' +
                    '</div>';
                }).join('')}
            </div>
            
            <!-- CTA final -->
            <div class="text-center mt-10 md:mt-14 reveal-up">
                <p class="text-xs text-gray-500 font-medium mb-4">¿Tienes otra pregunta? ¡Escríbenos!</p>
                <button onclick="window.open('https://wa.me/' + window.getDefaultContactNumber() + '?text=Hola%20Emma%20Store,%20tengo%20una%20consulta', '_blank')" 
                        class="btn-premium pulse-green bg-green-500 hover:bg-green-600 text-white px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:shadow-2xl active:scale-95 inline-flex items-center gap-3 transition-all">
                    <i class="fa-brands fa-whatsapp text-lg"></i> Escribir por WhatsApp
                </button>
            </div>
        </div>
    `;
    container.appendChild(div);
    initRevealAnimations();
}



function renderRandomCategoryCarousel(container) {
    if (!state.randomCategoryId) return;
    const catProducts = state.products.filter(p => p.categoryId == state.randomCategoryId);
    if (catProducts.length === 0) return;

    if (window.randomCatCarouselInterval) {
        clearInterval(window.randomCatCarouselInterval);
        window.randomCatCarouselInterval = null;
    }

    const section = document.createElement('div');
    section.className = "max-w-7xl mx-auto px-6 py-12 md:py-16 animate-fade reveal-up";
    section.innerHTML = `
        <div class="category-carousel-section rounded-[2.5rem] md:rounded-[3.5rem] p-6 md:p-10 relative overflow-hidden">
            <div class="absolute -right-16 -top-16 w-64 h-64 bg-gray-100/50 rounded-full blur-3xl pointer-events-none"></div>
            
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <span class="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-black text-white rounded-full text-[8px] font-black uppercase tracking-[0.2em] mb-3">
                        <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                        Categoría: ${state.randomCategoryName}
                    </span>
                    <h2 class="text-xl md:text-3xl font-black uppercase text-black tracking-tight">Colección Destacada</h2>
                    <p class="text-[10px] md:text-xs text-gray-400 font-bold mt-1">Nuestra mejor selección de esta categoría para ti.</p>
                </div>
                <button onclick="window.filterCategory(${state.randomCategoryId})" class="text-[9px] font-black uppercase tracking-widest text-white bg-black hover:bg-gray-900 rounded-2xl px-6 py-3.5 transition-all select-none active:scale-95 cursor-pointer shadow-md">
                    Ver Colección
                </button>
            </div>
            
            <div class="relative group/slider">
                <!-- Flecha de navegación Izquierda -->
                <button id="random-cat-prev-btn" class="absolute left-2 md:-left-5 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full flex items-center justify-center text-black carousel-nav-btn select-none cursor-pointer hover:shadow-lg transition-all duration-300">
                    <i class="fa-solid fa-chevron-left text-xs"></i>
                </button>
                
                <!-- Lista de productos scrollable y snapable -->
                <div class="flex gap-4 md:gap-6 overflow-x-auto no-scrollbar pb-3 overscroll-x-contain scroll-smooth snap-x snap-mandatory" id="random-cat-carousel-list">
                    ${catProducts.map(p => {
                        const isOutOfStock = p.inStock === false;
                        return `
                            <div class="w-36 md:w-52 flex-shrink-0 flex flex-col justify-between group relative bg-white border border-gray-100 p-3 rounded-2xl md:rounded-[1.75rem] transition-all duration-300 hover:shadow-xl hover:border-gray-200 hover:-translate-y-1 cursor-pointer snap-start" onclick="window.navigate('detail', ${p.id})">
                                <div class="aspect-[3/4] overflow-hidden bg-gray-50 rounded-xl md:rounded-[1.25rem] relative mb-3">
                                    <img src="${p.images && p.images.length ? p.images[0] : ''}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105">
                                    ${isOutOfStock ? `
                                        <div class="absolute top-2 left-2 bg-black/60 backdrop-blur-sm text-white px-2 py-1 rounded-full text-[6px] font-black uppercase tracking-wider">Agotado</div>
                                    ` : ''}
                                </div>
                                <div class="px-1 text-center flex flex-col items-center gap-1.5">
                                    <span class="text-[8px] font-extrabold uppercase tracking-wider text-gray-400 block mb-1">${state.randomCategoryName}</span>
                                    <h4 class="text-[10px] md:text-xs font-black uppercase text-black line-clamp-1 leading-tight mb-1 group-hover:text-gray-600 transition-colors">${p.name}</h4>
                                    <div class="mt-1">
                                        <span class="price-shine-move text-base md:text-lg">BS ${p.price}</span>
                                    </div>
                                    ${!isOutOfStock ? `
                                        <button onclick="event.stopPropagation(); addToCart(${p.id})" class="mt-1 py-1.5 px-4 bg-black hover:bg-gray-800 text-white rounded-full text-[9px] font-black uppercase tracking-wider flex items-center gap-1 transition-all active:scale-90 shadow-sm border-none cursor-pointer">
                                            <i class="fa-solid fa-plus"></i> Añadir
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>

                <!-- Flecha de navegación Derecha -->
                <button id="random-cat-next-btn" class="absolute right-2 md:-right-5 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full flex items-center justify-center text-black carousel-nav-btn select-none cursor-pointer hover:shadow-lg transition-all duration-300">
                    <i class="fa-solid fa-chevron-right text-xs"></i>
                </button>
            </div>
        </div>
    `;
    container.appendChild(section);

    // Inicializar listeners del slider
    const list = section.querySelector('#random-cat-carousel-list');
    const prevBtn = section.querySelector('#random-cat-prev-btn');
    const nextBtn = section.querySelector('#random-cat-next-btn');

    if (list && prevBtn && nextBtn) {
        let userInteracted = false;

        const stopAutoScroll = () => {
            if (userInteracted) return;
            userInteracted = true;
            if (window.randomCatCarouselInterval) {
                clearInterval(window.randomCatCarouselInterval);
                window.randomCatCarouselInterval = null;
            }
        };

        // Detener auto-scroll permanentemente en cualquier interacción manual
        list.addEventListener('pointerdown', stopAutoScroll, { passive: true });
        list.addEventListener('wheel', stopAutoScroll, { passive: true });

        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            stopAutoScroll();
            const scrollAmount = list.clientWidth * 0.75;
            list.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
        });

        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            stopAutoScroll();
            const scrollAmount = list.clientWidth * 0.75;
            list.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        });

        // Auto-desplazamiento automático cada 5 segundos
        window.randomCatCarouselInterval = setInterval(() => {
            // Validar que el elemento aún exista en el DOM
            if (!document.getElementById('random-cat-carousel-list')) {
                clearInterval(window.randomCatCarouselInterval);
                window.randomCatCarouselInterval = null;
                return;
            }

            const maxScroll = list.scrollWidth - list.clientWidth;
            if (list.scrollLeft >= maxScroll - 10) {
                // Volver al principio
                list.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                // Desplazarse a la derecha
                list.scrollBy({ left: list.clientWidth * 0.75, behavior: 'smooth' });
            }
        }, 5000);
    }
}

function renderRandomProductSpotlight(container) {
    // Seleccionar 5 productos aleatorios para recomendar
    const products = state.products.slice().sort(() => 0.5 - Math.random()).slice(0, 5);
    if (!products || products.length === 0) return;

    if (window.spotlightCarouselInterval) {
        clearInterval(window.spotlightCarouselInterval);
        window.spotlightCarouselInterval = null;
    }

    const section = document.createElement('div');
    section.className = "max-w-7xl mx-auto px-6 py-12 md:py-16 animate-fade reveal-up relative group/spotlight";
    
    section.innerHTML = `
        <!-- Flecha de navegación Izquierda -->
        <button id="spotlight-prev-btn" class="absolute left-2 md:-left-5 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/10 border border-white/10 shadow-lg flex items-center justify-center text-white opacity-85 hover:opacity-100 hover:bg-white/20 active:scale-95 transition-all duration-300 cursor-pointer">
            <i class="fa-solid fa-chevron-left text-xs"></i>
        </button>

        <!-- Contenedor Deslizable Principal -->
        <div class="flex overflow-x-auto no-scrollbar pb-1 overscroll-x-contain scroll-smooth snap-x snap-mandatory rounded-[2.5rem] md:rounded-[3.5rem]" id="spotlight-carousel-list">
            ${products.map(p => {
                const cat = state.categories.find(c => c.id == p.categoryId);
                const categoryLabel = cat ? cat.name.toUpperCase() : 'NUEVO';
                const isOutOfStock = p.inStock === false;
                const features = window.getProductFeatures(p);

                return `
                    <div class="w-full flex-shrink-0 snap-start bg-black text-white relative overflow-hidden emma-floating-slide">
                        <div class="absolute -left-20 -bottom-20 w-80 h-80 bg-white/5 rounded-full blur-3xl pointer-events-none"></div>
                        
                        <div class="flex flex-col lg:flex-row gap-6 lg:gap-12 items-center justify-center p-8 md:p-14">
                            
                            <!-- Columna Izquierda: Información del producto -->
                            <div class="w-full lg:w-[55%] flex flex-col items-center text-center order-2 lg:order-1 relative z-10">
                                <div class="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white/10 rounded-full border border-white/10 mb-6">
                                    <span class="text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em] text-white/80">★ Recomendado de la Semana</span>
                                </div>
                                
                                <span class="text-[8px] md:text-[10px] font-black tracking-widest text-white/40 uppercase mb-2">${categoryLabel}</span>
                                <h3 class="text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-normal text-white leading-[0.95] mb-6">
                                    ${p.name}
                                </h3>
                                
                                <!-- Lista de características con checkmarks alineada a la izquierda -->
                                <div class="space-y-3 mb-8 flex flex-col items-start text-left w-fit mx-auto">
                                    ${features.length > 0 ? features.map(f => `
                                        <div class="text-xs md:text-sm text-white/80 flex items-start gap-2.5 font-medium leading-relaxed">
                                            <i class="fa-solid fa-circle-check text-green-400 text-sm mt-0.5 flex-shrink-0"></i>
                                            <span>${f}</span>
                                        </div>
                                    `).join('') : `
                                        <div class="text-xs md:text-sm text-white/80 flex items-start gap-2.5 font-medium leading-relaxed">
                                            <i class="fa-solid fa-circle-check text-green-400 text-sm mt-0.5 flex-shrink-0"></i>
                                            <span>Garantía oficial y envío delivery a domicilio</span>
                                        </div>
                                        <div class="text-xs md:text-sm text-white/80 flex items-start gap-2.5 font-medium leading-relaxed">
                                            <i class="fa-solid fa-circle-check text-green-400 text-sm mt-0.5 flex-shrink-0"></i>
                                            <span>Calidad superior certificada de Emma Store</span>
                                        </div>
                                    `}
                                </div>
                                
                                <div class="text-center mb-8">
                                    <span class="price-shine-move-white text-3xl md:text-4xl">BS ${p.price}</span>
                                </div>
                                
                                <div class="flex flex-col sm:flex-row gap-4 w-full sm:w-auto justify-center">
                                    ${isOutOfStock ? `
                                        <button disabled class="w-full sm:w-auto bg-white/10 text-white/40 border border-white/10 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest cursor-not-allowed select-none">
                                            Agotado temporalmente
                                        </button>
                                    ` : `
                                        <button onclick="addToCart(${p.id})" class="btn-premium bg-white text-black px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-100 active:scale-95 transition-all flex items-center justify-center gap-3 w-full sm:w-auto shadow-xl border-none cursor-pointer">
                                            <i class="fa-solid fa-plus text-xs"></i> Añadir a la bolsa
                                        </button>
                                    `}
                                    <button onclick="window.navigate('detail', ${p.id})" class="w-full sm:w-auto bg-transparent text-white border border-white/20 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/5 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer">
                                        Ver detalles
                                    </button>
                                </div>
                            </div>
                            
                            <!-- Columna Derecha: Imagen del producto agrandada y con cinematica de tambalear -->
                            <div class="w-full lg:w-[45%] flex items-center justify-center order-1 lg:order-2 relative z-10">
                                <div class="relative w-56 h-56 sm:w-64 sm:h-64 lg:w-[26rem] lg:h-[26rem] rounded-[2rem] overflow-hidden bg-white/5 border border-white/10 p-2 shadow-2xl hover:scale-[1.02] transition-transform duration-500 wobble-cinematic cursor-pointer" onclick="navigate('detail', ${p.id})">
                                    <img src="${p.images && p.images.length ? p.images[0] : ''}" class="w-full h-full object-cover rounded-[1.75rem]">
                                </div>
                            </div>
                            
                        </div>
                    </div>
                `;
            }).join('')}
        </div>

        <!-- Flecha de navegación Derecha -->
        <button id="spotlight-next-btn" class="absolute right-2 md:-right-5 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/10 border border-white/10 shadow-lg flex items-center justify-center text-white opacity-85 hover:opacity-100 hover:bg-white/20 active:scale-95 transition-all duration-300 cursor-pointer">
            <i class="fa-solid fa-chevron-right text-xs"></i>
        </button>
    `;
    container.appendChild(section);

    // Inicializar listeners del slider de spotlight
    const list = section.querySelector('#spotlight-carousel-list');
    const prevBtn = section.querySelector('#spotlight-prev-btn');
    const nextBtn = section.querySelector('#spotlight-next-btn');

    if (list && prevBtn && nextBtn) {
        let userInteracted = false;

        const stopAutoScroll = () => {
            if (userInteracted) return;
            userInteracted = true;
            if (window.spotlightCarouselInterval) {
                clearInterval(window.spotlightCarouselInterval);
                window.spotlightCarouselInterval = null;
            }
        };

        // Detener auto-scroll permanentemente en cualquier interacción manual
        list.addEventListener('pointerdown', stopAutoScroll, { passive: true });
        list.addEventListener('wheel', stopAutoScroll, { passive: true });

        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            stopAutoScroll();
            list.scrollBy({ left: -list.clientWidth, behavior: 'smooth' });
        });

        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            stopAutoScroll();
            list.scrollBy({ left: list.clientWidth, behavior: 'smooth' });
        });

        // Auto-desplazamiento automático cada 5 segundos
        window.spotlightCarouselInterval = setInterval(() => {
            if (!document.getElementById('spotlight-carousel-list')) {
                clearInterval(window.spotlightCarouselInterval);
                window.spotlightCarouselInterval = null;
                return;
            }

            const maxScroll = list.scrollWidth - list.clientWidth;
            if (list.scrollLeft >= maxScroll - 10) {
                // Volver al principio
                list.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                // Desplazarse a la derecha
                list.scrollBy({ left: list.clientWidth, behavior: 'smooth' });
            }
        }, 5000);
    }
}

function renderSubmenu(container) {
    const div = document.createElement('div');
    div.id = "category-carousel";
    div.className = "max-w-7xl mx-auto px-6 mb-10 flex gap-4 overflow-x-auto no-scrollbar py-2 overscroll-x-contain scroll-smooth";
    div.innerHTML = `<button onclick="filterCategory('todas')" class="px-7 py-3 rounded-full text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${state.selectedCategory === 'todas' ? 'bg-black text-white shadow-md' : 'bg-gray-50 border border-gray-150 text-gray-500 hover:text-black hover:bg-gray-100' }">Todas</button>` + 
    state.categories.map(c => `<button onclick="filterCategory(${c.id})" class="px-7 py-3 rounded-full text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${state.selectedCategory == c.id ? 'bg-black text-white shadow-md' : 'bg-gray-50 border border-gray-150 text-gray-500 hover:text-black hover:bg-gray-100' }">${c.name}</button>`).join('');
    container.appendChild(div);
    if (window.initCategoryCarousel) {
        window.initCategoryCarousel(div);
    }
}

function renderCatalog(container) {
    let filtered = window.getFilteredProducts();

    const grid = document.createElement('div');
    grid.className = "max-w-7xl mx-auto px-6 grid grid-cols-2 lg:grid-cols-4 gap-x-4 md:gap-x-8 gap-y-8 md:gap-y-12 animate-fade";
    
    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="col-span-2 lg:col-span-4 text-center py-20 text-gray-400 font-bold uppercase tracking-widest text-xs">
                No se encontraron productos
            </div>
        `;
        container.appendChild(grid);
        return;
    }

    // 1. Featured Category Block at the very top (first element) - Seleccionado de forma aleatoria
    let featuredCategoryHTML = '';
    if (state.categories.length > 0) {
        let featuredCat = null;
        let featuredCatProducts = [];
        // Ordenar categorías aleatoriamente para recomendar una colección distinta cada vez
        const shuffledCats = state.categories.slice().sort(() => 0.5 - Math.random());
        for (const cat of shuffledCats) {
            const prods = state.products.filter(p => p.categoryId == cat.id);
            if (prods.length > 0) {
                featuredCat = cat;
                // Tomar hasta 8 productos aleatorios de esta categoría
                featuredCatProducts = prods.slice().sort(() => 0.5 - Math.random()).slice(0, 8);
                break;
            }
        }

        if (featuredCat && featuredCatProducts.length > 0) {
            featuredCategoryHTML = `
            <div class="product-card group relative col-span-2 lg:col-span-4 bg-gray-50/40 border border-gray-100 rounded-[2rem] md:rounded-[3rem] p-5 md:p-8 text-left">
                <div class="flex justify-between items-center mb-6">
                    <div>
                        <span class="text-[8px] font-black uppercase text-gray-400 tracking-[0.2em]">Colección Destacada</span>
                        <h2 class="text-base md:text-2xl font-black uppercase text-black mt-1">${featuredCat.name}</h2>
                    </div>
                    <button onclick="filterCategory(${featuredCat.id})" class="text-[9px] font-black uppercase tracking-wider text-black bg-white border border-gray-150 rounded-full px-5 py-2.5 hover:bg-gray-50 transition-all select-none active:scale-95 cursor-pointer">Ver todo</button>
                </div>
                <div class="flex gap-4 overflow-x-auto no-scrollbar pb-2 overscroll-x-contain scroll-smooth" id="featured-cat-carousel">
                    ${featuredCatProducts.map(p => `
                        <div class="w-32 md:w-44 flex-shrink-0 flex flex-col justify-between cursor-pointer bg-white border border-gray-100 p-3 rounded-2xl md:rounded-[1.75rem] transition-all duration-300 hover:shadow-xl hover:border-gray-200 hover:-translate-y-1" onclick="navigate('detail', ${p.id})">
                            <div class="aspect-square overflow-hidden bg-gray-50 border border-gray-100 shadow-sm relative mb-3 rounded-xl md:rounded-[1.25rem]">
                                <img src="${p.images && p.images.length ? p.images[0] : ''}" class="w-full h-full object-cover transition-transform duration-500 hover:scale-105">
                            </div>
                            <div class="px-1 text-center flex flex-col items-center gap-1">
                                <h4 class="text-xs md:text-sm font-black uppercase text-black line-clamp-1 leading-tight mb-1">${p.name}</h4>
                                <div>
                                    <span class="price-shine-move text-base md:text-lg">BS ${p.price}</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`;
        }
    }

    // Determine spacing: every 2 rows (4 products on mobile, 8 products on PC)
    const spacing = window.innerWidth >= 1024 ? 8 : 4;

    const cardsHTML = filtered.map((p, index) => {
        const cat = state.categories.find(c => c.id == p.categoryId);
        const categoryLabel = cat ? cat.name.toUpperCase() : 'COLECCIÓN';
        const isOutOfStock = p.inStock === false;

        // Render as wide card if index is at the spacing interval
        if (index > 0 && index % (spacing + 1) === spacing) {
            const features = window.getProductFeatures(p);
            const featuresHTML = features.length > 0 ? features.map(f => `
                <div class="text-[9px] md:text-xs text-white/80 flex items-start gap-2.5 font-medium leading-relaxed">
                    <i class="fa-solid fa-circle-check text-green-400 text-[10px] md:text-[12px] mt-0.5 flex-shrink-0"></i>
                    <span>${f}</span>
                </div>
            `).join('') : `
                <div class="text-[9px] md:text-xs text-white/80 flex items-start gap-2.5 font-medium leading-relaxed">
                    <i class="fa-solid fa-circle-check text-green-400 text-[10px] md:text-[12px] mt-0.5 flex-shrink-0"></i>
                    <span>Garantía oficial y envío delivery a domicilio</span>
                </div>
                <div class="text-[9px] md:text-xs text-white/80 flex items-start gap-2.5 font-medium leading-relaxed">
                    <i class="fa-solid fa-circle-check text-green-400 text-[10px] md:text-[12px] mt-0.5 flex-shrink-0"></i>
                    <span>Calidad superior certificada de Emma Store</span>
                </div>
            `;

            return `
            <div class="product-card group relative col-span-2 lg:col-span-4 bg-black text-white rounded-[2rem] md:rounded-[3rem] p-6 md:p-10 flex flex-col md:flex-row gap-6 md:gap-12 lg:gap-20 items-center justify-center overflow-hidden shadow-2xl border border-white/5 emma-floating-slide">
                <div class="absolute -left-20 -bottom-20 w-80 h-80 bg-white/5 rounded-full blur-3xl pointer-events-none"></div>
                
                <!-- Left Content: Info -->
                <div class="w-full md:w-[55%] flex flex-col items-center md:items-start text-center md:text-left order-2 md:order-1 relative z-10">
                    <div class="inline-flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full border border-white/10 mb-4">
                        <span class="text-[7px] md:text-[8px] font-black uppercase tracking-[0.2em] text-white/85">★ Recomendado de la Semana</span>
                    </div>
                    
                    <span class="text-[8px] md:text-[9px] font-black tracking-widest text-white/40 uppercase mb-1 md:mb-2">${categoryLabel}</span>
                    <h3 class="text-lg sm:text-xl md:text-3xl font-black uppercase tracking-normal text-white leading-[1.05] mb-4 md:mb-5">
                        ${p.name}
                    </h3>
                    
                    <!-- Checklist -->
                    <div class="space-y-2.5 mb-5 md:mb-6 text-left w-full">
                        ${featuresHTML}
                    </div>
                    
                    <div class="text-center md:text-left mb-5 md:mb-6">
                        <span class="price-shine-move-white text-xl md:text-2xl">BS ${p.price}</span>
                    </div>
                    
                    <div class="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                        ${isOutOfStock ? `
                            <button disabled class="w-full sm:w-auto bg-white/10 text-white/40 border border-white/10 px-6 py-3.5 rounded-xl text-[9px] font-black uppercase tracking-widest cursor-not-allowed select-none">
                                Agotado
                            </button>
                        ` : `
                            <button onclick="addToCart(${p.id})" class="btn-premium bg-white text-black px-6 py-3.5 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-gray-100 active:scale-95 transition-all flex items-center justify-center gap-2 w-full sm:w-auto shadow-xl border-none cursor-pointer">
                                <i class="fa-solid fa-plus text-[10px]"></i> Añadir a la bolsa
                            </button>
                        `}
                        <button onclick="navigate('detail', ${p.id})" class="w-full sm:w-auto bg-transparent text-white border border-white/20 px-6 py-3.5 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-white/5 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer">
                            Ver detalles
                        </button>
                    </div>
                </div>

                <!-- Right Content: Image -->
                <div class="w-full md:w-[35%] flex items-center justify-center order-1 md:order-2 relative z-10">
                    <div class="relative w-48 h-48 sm:w-56 sm:h-56 md:w-64 md:h-64 lg:w-72 lg:h-72 rounded-2xl overflow-hidden bg-white/5 border border-white/10 p-2 shadow-2xl hover:scale-[1.02] transition-transform duration-500 cursor-pointer" onclick="navigate('detail', ${p.id})">
                        <img src="${p.images && p.images.length ? p.images[0] : ''}" onload="this.classList.remove('opacity-0')" class="w-full h-full object-cover rounded-xl transition-all duration-700 opacity-0">
                    </div>
                </div>
            </div>`;
        }

        return `
        <div class="product-card group relative flex flex-col justify-between ${isOutOfStock ? 'opacity-80' : ''}">
            <div>
                <div class="aspect-square overflow-hidden bg-gray-50 mb-4 md:mb-6 relative cursor-pointer shadow-sm border border-gray-100" 
                     onmouseenter="${isOutOfStock ? '' : `startCatalogHoverSlide(this, '${encodeURIComponent(JSON.stringify(p.images || []))}')`}" 
                     onmouseleave="${isOutOfStock ? '' : `stopCatalogHoverSlide(this, '${p.images && p.images.length ? p.images[0] : ''}')`}"
                     onclick="navigate('detail', ${p.id})">
                    <img src="${p.images && p.images.length ? p.images[0] : ''}" onload="this.classList.remove('opacity-0')" class="product-image w-full h-full object-cover transition-all duration-700 opacity-0">
                    
                    ${isOutOfStock ? `
                        <!-- Etiqueta Agotado -->
                        <div class="absolute top-4 left-4 bg-black/60 backdrop-blur-sm text-white px-3.5 py-1.5 rounded-full text-[8px] font-black uppercase tracking-wider select-none">
                            Agotado
                        </div>
                    ` : `
                        <!-- Botón Quick-Add Flotante para Móviles -->
                        <button onclick="event.stopPropagation(); addToCart(${p.id})" 
                                class="md:hidden absolute bottom-3 right-3 z-10 w-10 h-10 bg-white/90 backdrop-blur-md text-black rounded-full flex items-center justify-center shadow-md active:scale-90 transition-all border border-gray-100">
                            <i class="fa-solid fa-plus text-xs"></i>
                        </button>
                    `}
                </div>
                <div class="text-center px-1 mb-4 flex flex-col items-center gap-1">
                    <h3 class="text-xs md:text-sm font-black uppercase text-black line-clamp-1 leading-tight mb-1">${p.name}</h3>
                    <div>
                        <span class="price-shine-move text-base md:text-lg">BS ${p.price}</span>
                    </div>
                </div>
            </div>
            <!-- Botón Añadir para PC -->
            ${isOutOfStock ? `
                <button disabled class="hidden md:block w-full bg-gray-150 text-gray-400 py-3.5 rounded-2xl text-[9px] font-black uppercase tracking-widest cursor-not-allowed select-none">Agotado</button>
            ` : `
                <button onclick="addToCart(${p.id})" class="hidden md:block w-full bg-black text-white py-3.5 rounded-2xl text-[9px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all shadow-md hover:shadow-lg">Añadir a la bolsa</button>
            `}
        </div>`;
    }).join('');

    grid.innerHTML = featuredCategoryHTML + cardsHTML;
    container.appendChild(grid);
    if (window.initScrollReveal) {
        window.initScrollReveal();
    }
    initRevealAnimations();
}

function renderDetail(container) {
    const p = state.selectedProduct;
    // Clear any active countdown timers
    clearInterval(window.promoCountdownInterval);

    const isPromo = p.hasOwnProperty('endsAt');
    const cat = state.categories.find(c => c.id == p.categoryId);
    const categoryLabel = cat ? cat.name.toUpperCase() : 'COLECCIÓN';
    const isOutOfStock = p.inStock === false;

    // Use window.getProductFeatures helper to extract checkmark features
    const features = window.getProductFeatures(p);
    const featuresHTML = features.length > 0 ? `
        <div class="space-y-3">
            ${features.map(f => `
                <div class="text-xs md:text-sm text-white/80 flex items-start gap-2.5 font-medium leading-relaxed">
                    <i class="fa-solid fa-circle-check text-green-400 text-sm mt-0.5 flex-shrink-0"></i>
                    <span>${f}</span>
                </div>
            `).join('')}
        </div>
    ` : `
        <p class="text-xs md:text-sm leading-relaxed text-white/85 font-medium">
            ${p.description || 'Este producto exclusivo de Emma Store no cuenta con una descripción detallada en este momento.'}
        </p>
    `;

    let promoCountdownHTML = '';
    if (isPromo) {
        const dateStr = new Date(p.endsAt).toLocaleString('es-BO', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        promoCountdownHTML = `
            <div class="mb-6 bg-red-950/40 p-5 rounded-2xl border border-red-500/20 text-left">
                <div class="flex items-center gap-2 mb-2 text-red-400">
                    <span class="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                    <h4 class="text-[9px] font-black uppercase tracking-widest">Promoción Especial</h4>
                </div>
                <p class="text-xl md:text-2xl font-black text-white" id="promo-detail-countdown" data-ends="${p.endsAt}">
                    Vence en: ${formatCountdown(p.endsAt)}
                </p>
                <p class="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-1.5">
                    Vence el: ${dateStr}
                </p>
            </div>
        `;
    }

    // Determine target ID string
    const promoIdStr = isPromo ? `promo_${p.id}` : `prod_${p.id}`;

    container.innerHTML = `
    <div class="max-w-7xl mx-auto px-6 py-8 md:py-16 bg-black text-white rounded-[2rem] md:rounded-[3rem] shadow-2xl border border-white/5 relative overflow-hidden animate-fade mt-6">
        <div class="absolute -left-20 -bottom-20 w-96 h-96 bg-white/5 rounded-full blur-3xl pointer-events-none"></div>
        
        <div class="lg:flex gap-16 items-center justify-center relative z-10 p-4 md:p-6">
            
            <!-- Columna Izquierda: Imagen del producto -->
            <div class="lg:w-1/2 mb-8 lg:mb-0 reveal-up active flex flex-col items-center">
                <div class="relative w-full aspect-square max-w-md bg-white/5 rounded-[2rem] md:rounded-[3rem] overflow-hidden shadow-2xl border border-white/10 cursor-zoom-in group transition-transform duration-500 emma-floating-card" onclick="openLightbox()">
                    <!-- Botón Volver Flotante en Imagen (Móviles) -->
                    <button onclick="event.stopPropagation(); window.goBack()" 
                            class="md:hidden absolute top-4 left-4 z-10 w-10 h-10 bg-black/80 backdrop-blur-md text-white rounded-full flex items-center justify-center shadow-md active:scale-90 transition-all border border-white/10">
                        <i class="fa-solid fa-chevron-left text-sm"></i>
                    </button>
                    
                    <img id="detail-main-img" src="${p.images[state.detailActiveImg]}" class="w-full h-full object-cover transition-all duration-500 group-hover:scale-105">
                    
                    <div class="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-md text-white px-5 py-2.5 rounded-full text-[9px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity shadow-xl border border-white/10">
                        <i class="fa-solid fa-expand mr-1"></i> Expandir
                    </div>
                </div>
                
                <!-- Miniaturas -->
                <div class="flex gap-3 mt-4 md:mt-6 overflow-x-auto no-scrollbar overscroll-x-contain scroll-smooth py-2 justify-center w-full">
                    ${p.images.map((img, i) => `
                        <button onclick="changeDetailImg(${i}, true)" 
                                class="thumb-btn flex-shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-xl md:rounded-2xl border-2 transition-all duration-300 overflow-hidden hover:-translate-y-1 ${i === state.detailActiveImg ? 'border-white opacity-100 shadow-md' : 'border-transparent opacity-50 hover:opacity-100'}">
                            <img src="${img}" class="w-full h-full object-cover">
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- Columna Derecha: Información del producto -->
            <div class="lg:w-1/2 flex flex-col justify-center reveal-up active text-center items-center" style="transition-delay: 0.2s">
                <div class="inline-flex items-center gap-2 px-4 py-2 bg-white/10 rounded-full border border-white/10 shadow-sm mb-4 w-fit mx-auto">
                    <span class="text-[9px] font-black tracking-[0.3em] text-white/85 uppercase">Emma Store • ${categoryLabel}</span>
                </div>
                
                <h1 class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black uppercase tracking-normal mb-4 text-white leading-none py-1 text-center">${p.name}</h1>
                <p class="text-center mb-6">
                    <span class="price-shine-move-white text-4xl md:text-6xl font-black font-serif tracking-tight">BS ${p.price}</span>
                </p>
                
                ${promoCountdownHTML}

                <div class="mb-6 md:mb-8 bg-white/5 p-6 md:p-8 rounded-[2rem] border border-white/10">
                    <h4 class="text-[10px] font-black uppercase tracking-widest text-white/50 mb-4 flex items-center gap-2">
                        <i class="fa-solid fa-circle-info"></i> Detalles del producto
                    </h4>
                    ${featuresHTML}
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    ${isOutOfStock ? `
                        <button disabled class="w-full bg-white/10 text-white/40 border border-white/10 py-4 md:py-5 rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-widest cursor-not-allowed select-none">
                            Agotado temporalmente
                        </button>
                    ` : `
                        <button onclick="addToCart('${promoIdStr}')" class="btn-premium bg-white text-black py-4 md:py-5 rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-widest shadow-xl hover:shadow-2xl transition-all active:scale-95 flex items-center justify-center gap-2 border-none cursor-pointer">
                            <i class="fa-solid fa-bag-shopping"></i> Añadir a la bolsa
                        </button>
                    `}
                    <button onclick="askInfo('${promoIdStr}')" class="btn-premium bg-green-500 hover:bg-green-600 text-white py-4 md:py-5 rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-widest shadow-xl hover:shadow-2xl flex items-center justify-center gap-3 active:scale-95 transition-all border-none cursor-pointer">
                        <i class="fa-solid fa-bolt text-sm"></i> Realizar pedido
                    </button>
                </div>
                
                <button onclick="window.goBack()" class="w-full py-4 md:py-5 bg-transparent border-2 border-white/20 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/5 transition-all active:scale-95 flex items-center justify-center gap-2 group cursor-pointer">
                    <i class="fa-solid fa-arrow-left transition-transform group-hover:-translate-x-1"></i> Volver al catálogo
                </button>
            </div>
            
        </div>
    </div>`;

    // Active promo countdown interval
    if (isPromo) {
        window.promoCountdownInterval = setInterval(() => {
            const el = document.getElementById('promo-detail-countdown');
            if (!el) {
                clearInterval(window.promoCountdownInterval);
                return;
            }
            const endsAt = parseInt(el.getAttribute('data-ends'));
            const text = formatCountdown(endsAt);
            el.innerText = `Vence en: ${text}`;
            if (endsAt <= Date.now()) {
                clearInterval(window.promoCountdownInterval);
                alert("Esta promoción ha vencido.");
                window.goBack();
            }
        }, 1000);
    }

    // ===== PRODUCTOS SUGERIDOS =====
    const relatedProducts = state.products.filter(rp =>
        rp.id !== p.id && rp.categoryId == p.categoryId
    ).slice(0, 8);
    const otherProducts = relatedProducts.length < 4
        ? state.products.filter(rp => rp.id !== p.id).slice(0, 8 - relatedProducts.length)
        : [];
    const suggestedProducts = [...relatedProducts, ...otherProducts].slice(0, 6);

    if (suggestedProducts.length > 0) {
        const suggestedDiv = document.createElement('div');
        suggestedDiv.className = 'max-w-7xl mx-auto px-6 py-10 md:py-16';
        suggestedDiv.innerHTML = `
            <div class="mb-8">
                <p class="text-[10px] md:text-xs font-black uppercase tracking-[0.4em] text-gray-400 mb-2 reveal-up">También te puede interesar</p>
                <h2 class="text-2xl sm:text-3xl md:text-4xl font-black uppercase tracking-tighter text-black leading-none reveal-up">
                    Productos Relacionados
                </h2>
            </div>
            <div class="flex gap-4 md:gap-6 overflow-x-auto no-scrollbar pb-3 overscroll-x-contain scroll-smooth snap-x snap-mandatory">
                ${suggestedProducts.map(sp => {
                    const isOOS = sp.inStock === false;
                    const catSug = state.categories.find(c => c.id == sp.categoryId);
                    return `
                    <div class="w-40 md:w-56 flex-shrink-0 flex flex-col justify-between group relative bg-white border border-gray-100 p-3 rounded-2xl md:rounded-[1.75rem] transition-all duration-300 hover:shadow-xl hover:border-gray-200 hover:-translate-y-1 cursor-pointer snap-start"
                         onclick="window.navigate('detail', ${sp.id})">
                        <div class="aspect-[3/4] overflow-hidden bg-gray-50 rounded-xl md:rounded-[1.25rem] relative mb-3">
                            <img src="${sp.images && sp.images.length ? sp.images[0] : ''}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105">
                            ${isOOS ? `<div class="absolute top-2 left-2 bg-black/60 backdrop-blur-sm text-white px-2 py-1 rounded-full text-[6px] font-black uppercase tracking-wider">Agotado</div>` : ''}
                        </div>
                        <div class="px-1 text-center flex flex-col items-center gap-1.5">
                            <span class="text-[8px] font-extrabold uppercase tracking-wider text-gray-400 block mb-1">${catSug ? catSug.name : 'Emma Store'}</span>
                            <h4 class="text-[10px] md:text-xs font-black uppercase text-black line-clamp-1 leading-tight mb-1 group-hover:text-gray-600 transition-colors">${sp.name}</h4>
                            <div class="mt-1">
                                <span class="price-shine-move text-base md:text-lg">BS ${sp.price}</span>
                            </div>
                            ${!isOOS ? `
                                <button onclick="event.stopPropagation(); addToCart(${sp.id})" class="mt-1 py-1.5 px-4 bg-black hover:bg-gray-800 text-white rounded-full text-[9px] font-black uppercase tracking-wider flex items-center gap-1 transition-all active:scale-90 shadow-sm border-none cursor-pointer">
                                    <i class="fa-solid fa-plus"></i> Añadir
                                </button>
                            ` : ''}
                        </div>
                    </div>`;
                }).join('')}
            </div>
        `;
        container.appendChild(suggestedDiv);
        initRevealAnimations();
    }

    // ===== FAQ COMPACTO EN DETALLE =====
    const detailFaqs = [
        { q: '¿Cuánto demora la entrega?', a: 'En zonas con cobertura local, el mismo día o al día siguiente. Para otras ciudades de Bolivia, 2 a 5 días hábiles por transportadora.' },
        { q: '¿Cómo coordino el pago?', a: 'Un asesor te contactará por WhatsApp para confirmar el pedido y acordar el método de pago (efectivo, QR o transferencia).' },
        { q: '¿Hay garantía?', a: 'Sí. Si tu producto tiene fallas de fábrica, coordina el cambio con nosotros por WhatsApp sin costo adicional.' },
        { q: '¿Puedo pedir más fotos del producto?', a: '¡Claro! Escríbenos por WhatsApp y te enviamos fotos o videos adicionales antes de confirmar tu pedido.' }
    ];

    const faqDetailDiv = document.createElement('div');
    faqDetailDiv.className = 'max-w-7xl mx-auto px-6 pb-16 md:pb-24';
    faqDetailDiv.innerHTML = `
        <div class="bg-white border border-gray-100 rounded-[2rem] md:rounded-[3rem] p-6 md:p-10 reveal-up">
            <div class="flex items-center justify-between mb-6">
                <div>
                    <p class="text-[9px] font-black uppercase tracking-[0.4em] text-gray-400 mb-1">Resolvemos tus dudas</p>
                    <h3 class="text-lg md:text-2xl font-black uppercase tracking-tighter text-black">Preguntas Frecuentes</h3>
                </div>
                <button onclick="window.open('https://wa.me/' + window.getDefaultContactNumber() + '?text=Hola%20Emma%20Store,%20tengo%20una%20consulta', '_blank')"
                        class="btn-premium pulse-green bg-green-500 hover:bg-green-600 text-white px-5 py-2.5 rounded-2xl text-[9px] font-black uppercase tracking-widest inline-flex items-center gap-2 transition-all active:scale-95 border-none cursor-pointer">
                    <i class="fa-brands fa-whatsapp"></i> Preguntar
                </button>
            </div>
            <div class="bg-gray-50 rounded-2xl overflow-hidden">
                ${detailFaqs.map(faq => `
                    <div class="faq-item px-5 py-4 border-b border-gray-100 last:border-b-0" onclick="window.toggleFaq(this)">
                        <div class="flex items-center justify-between gap-4">
                            <h4 class="text-[10px] md:text-xs font-black text-black uppercase tracking-wider">${faq.q}</h4>
                            <i class="fa-solid fa-chevron-down faq-chevron text-xs text-gray-400 flex-shrink-0"></i>
                        </div>
                        <div class="faq-answer">
                            <p class="text-xs text-gray-500 leading-relaxed font-medium">${faq.a}</p>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    container.appendChild(faqDetailDiv);
    initRevealAnimations();

    // ===== ANIMACIONES CINEMÁTICAS EN DETALLE =====
    requestAnimationFrame(() => {
        // Animar título letra por letra
        const titleEl = container.querySelector('h1');
        if (titleEl) {
            const text = titleEl.textContent;
            titleEl.innerHTML = text.split('').map((ch, i) => {
                if (ch === ' ') return ' ';
                return `<span class="detail-letter" style="display:inline-block; opacity:0; transform:translateY(20px); transition: opacity 0.4s ease ${i * 0.03}s, transform 0.4s ease ${i * 0.03}s">${ch}</span>`;
            }).join('');
            setTimeout(() => {
                titleEl.querySelectorAll('.detail-letter').forEach(el => {
                    el.style.opacity = '1';
                    el.style.transform = 'translateY(0)';
                });
            }, 80);
        }

        // Animar precio con slide-up
        const priceEl = container.querySelector('p.text-2xl, p.text-4xl');
        if (priceEl) {
            priceEl.style.opacity = '0';
            priceEl.style.transform = 'translateY(16px)';
            priceEl.style.transition = 'opacity 0.5s ease 0.35s, transform 0.5s ease 0.35s';
            setTimeout(() => {
                priceEl.style.opacity = '1';
                priceEl.style.transform = 'translateY(0)';
            }, 100);
        }

        // Animar características con stagger
        const featureItems = container.querySelectorAll('.detail-feature-item, .space-y-3 > div, .space-y-2\\.5 > div');
        featureItems.forEach((el, i) => {
            el.style.opacity = '0';
            el.style.transform = 'translateX(-12px)';
            el.style.transition = `opacity 0.4s ease ${0.5 + i * 0.08}s, transform 0.4s ease ${0.5 + i * 0.08}s`;
            setTimeout(() => {
                el.style.opacity = '1';
                el.style.transform = 'translateX(0)';
            }, 100);
        });

        // Animar botones de acción con fade
        const actionBtns = container.querySelectorAll('.grid.grid-cols-1.sm\\:grid-cols-2 button, .grid.grid-cols-1.sm\\:grid-cols-2 button');
        actionBtns.forEach((btn, i) => {
            btn.style.opacity = '0';
            btn.style.transform = 'translateY(12px)';
            btn.style.transition = `opacity 0.4s ease ${0.7 + i * 0.1}s, transform 0.4s ease ${0.7 + i * 0.1}s`;
            setTimeout(() => {
                btn.style.opacity = '1';
                btn.style.transform = 'translateY(0)';
            }, 100);
        });
    });
}

// --- MOTOR WHATSAPP ---
window.checkout = (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (state.cart.length === 0) return alert("Bolsa vacía");

    // Verificar si ya aceptó la privacidad una vez
    const privacyAccepted = localStorage.getItem('emma_privacy_accepted') === 'true';
    if (!privacyAccepted) {
        window.openLoginHookModal(() => {
            window.toggleCart(false);
            window.navigate('checkout');
        });
        return;
    }

    // Cerrar el carrito y navegar al checkout
    window.toggleCart(false);
    window.navigate('checkout');
};

function renderCheckout(container) {
    if (state.cart.length === 0) {
        showNotification("Tu bolsa de compras está vacía.");
        window.navigate('home');
        return;
    }
    const subtotal = state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const cache = JSON.parse(localStorage.getItem('emma_store_checkout_cache')) || {};
    
    // Determinar si es usuario logueado
    const isLogged = !!state.user;
    const hasAddresses = isLogged && state.addresses.length > 0;
    
    // Buscar la dirección por defecto o la primera si tiene
    let defaultAddr = null;
    if (hasAddresses) {
        defaultAddr = state.addresses.find(a => a.is_default) || state.addresses[0];
    }
    
    const emailVal = isLogged ? state.user.email : (cache.email || '');
    const phoneVal = isLogged && state.user.phone ? state.user.phone : (cache.phone || '');
    const firstNameVal = isLogged && state.user.name ? state.user.name.split(' ')[0] : (cache.first_name || '');
    const lastNameVal = isLogged && state.user.name ? state.user.name.split(' ').slice(1).join(' ') : (cache.last_name || '');
    
    const addressVal = defaultAddr ? defaultAddr.street : (cache.address || '');
    const mapsLinkVal = defaultAddr ? (defaultAddr.maps_link || '') : (cache.maps_link || '');
    const doorDescVal = defaultAddr ? (defaultAddr.door_description || '') : (cache.door_desc || '');
    const apartmentVal = defaultAddr ? (defaultAddr.apartment || '') : (cache.apartment || '');
    const cityVal = defaultAddr ? defaultAddr.city : (cache.city || state.selectedDepartment || 'Cochabamba');
    
    // Lógica del checkbox de guardado según requerimiento del cliente
    let saveInfoChecked = '';
    if (isLogged) {
        if (!hasAddresses) saveInfoChecked = 'checked';
    } else {
        saveInfoChecked = cache.save_info !== false ? 'checked' : '';
    }
    
    // Determinar si el usuario está en una zona con cobertura de delivery
    const userCity = cityVal || state.selectedDepartment || 'Cochabamba';
    const deliveryZones = (state.storeConfig && state.storeConfig.delivery_zones) || ['Cochabamba'];
    const isInCoverageZone = deliveryZones.some(z =>
        userCity.toLowerCase().includes(z.toLowerCase()) || z.toLowerCase().includes(userCity.toLowerCase())
    );
    const shippingCostLocal = (state.storeConfig && state.storeConfig.shipping_cost) || 15;
    const carrierCost = 0;

    // Costo inicial de envío según zona y opciones disponibles
    const opts = (state.storeConfig && state.storeConfig.shipping_options) || [];
    let shippingCost = carrierCost;
    if (isInCoverageZone) {
        if (opts.length > 0) {
            shippingCost = opts[0].price;
        } else {
            shippingCost = shippingCostLocal;
        }
    }
    
    const wrapper = document.createElement('div');
    wrapper.className = "max-w-7xl mx-auto px-4 py-8 flex flex-col lg:flex-row lg:gap-12 animate-fade text-black";
    
    // Estructura de dos columnas
    wrapper.innerHTML = `
    <!-- Columna Izquierda: Formulario (Shopify Checkout) -->
    <div class="w-full lg:w-7/12 space-y-8 order-2 lg:order-1">
        
        <!-- Sección de Contacto -->
        <div class="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xs font-black uppercase tracking-wider text-black">Contacto</h2>
                ${!state.user ? `<button onclick="window.openGoogleLogin()" class="text-xs font-bold text-blue-600 hover:underline">Iniciar sesión</button>` : ''}
            </div>
            <div class="space-y-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div class="relative">
                        <input type="email" id="chk-email" value="${emailVal}" placeholder="Correo electrónico" 
                               class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black transition-all font-medium">
                        <p class="text-[9px] text-red-500 font-bold mt-1 hidden" id="err-chk-email">Introduce un correo electrónico válido</p>
                    </div>
                    <div class="relative">
                        <input type="tel" id="chk-phone" value="${phoneVal}" placeholder="Número de Celular / WhatsApp" 
                               class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black transition-all font-medium">
                        <p class="text-[9px] text-red-500 font-bold mt-1 hidden" id="err-chk-phone">Introduce un número de celular</p>
                    </div>
                </div>
                <label class="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" id="chk-newsletter" class="rounded border-gray-300 text-black focus:ring-black w-4 h-4">
                    <span class="text-[10px] text-gray-500 font-bold">Enviarme novedades y ofertas por correo electrónico</span>
                </label>
            </div>
        </div>

        <!-- Sección de Entrega -->
        <div class="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
            <div class="flex justify-between items-center mb-1 gap-2">
                <h2 class="text-xs font-black uppercase tracking-wider text-black text-left">Entrega</h2>
                ${isLogged ? `
                    <select id="chk-saved-address" onchange="window.selectSavedAddress(this.value)" class="max-w-[180px] px-2 py-1.5 border border-gray-200 rounded-lg text-[9px] bg-gray-50 font-bold focus:border-black outline-none transition-all uppercase cursor-pointer truncate">
                        ${hasAddresses ? state.addresses.map((a, idx) => `
                            <option value="${idx}" ${defaultAddr && a.id === defaultAddr.id ? 'selected' : ''}>
                                ${a.label} - ${a.street.substring(0, 20)}${a.street.length > 20 ? '...' : ''}
                            </option>
                        `).join('') : ''}
                        <option value="new" ${!hasAddresses ? 'selected' : ''}>+ Agregar dirección</option>
                    </select>
                ` : ''}
            </div>
            
            <!-- Campo oculto para guardar el ID de la dirección seleccionada -->
            <input type="hidden" id="chk-address-id" value="${defaultAddr ? defaultAddr.id : ''}">

            <!-- Nombre y Apellidos -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="flex flex-col gap-1 text-left">
                    <input type="text" id="chk-first-name" value="${firstNameVal}" placeholder="Nombre" 
                           class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black transition-all font-medium">
                    <p class="text-[9px] text-red-500 font-bold mt-1 hidden" id="err-chk-first-name">Introduce tu nombre</p>
                </div>
                <div class="flex flex-col gap-1 text-left">
                    <input type="text" id="chk-last-name" value="${lastNameVal}" placeholder="Apellidos" 
                           class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black transition-all font-medium">
                    <p class="text-[9px] text-red-500 font-bold mt-1 hidden" id="err-chk-last-name">Introduce un apellido</p>
                </div>
            </div>

            <!-- Departamento / Ciudad -->
            <div class="relative text-left flex flex-col gap-1.5">
                <label class="text-[8px] font-black uppercase tracking-widest text-gray-400">Departamento</label>
                <select id="chk-city" onchange="window.updateCheckoutZone(this.value)"
                        class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs bg-white font-bold focus:border-black outline-none transition-all cursor-pointer">
                    ${['Beni','Chuquisaca','Cochabamba','La Paz','Oruro','Pando','Potos\u00ed','Santa Cruz','Tarija'].map(dept => `
                        <option value="${dept}" ${cityVal === dept ? 'selected' : ''}>${dept}</option>
                    `).join('')}
                </select>
                <p class="text-[9px] text-red-500 font-bold mt-1 hidden" id="err-chk-city">Selecciona tu departamento</p>
            </div>

            <!-- Campos de ubicación (Solo visibles si es una zona de cobertura de delivery local) -->
            <div id="chk-address-fields" class="${isInCoverageZone ? 'space-y-4' : 'hidden space-y-4'}">
                <!-- Etiqueta de la dirección (solo visible si es nueva) -->
                <div id="chk-address-label-container" class="relative text-left ${hasAddresses ? 'hidden' : ''}">
                    <input type="text" id="chk-address-label" placeholder="Nombre de la ubicación (Ej: CASA, OFICINA)" 
                           class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black transition-all font-medium uppercase">
                </div>

                <!-- País -->
                <div class="flex flex-col gap-1.5 text-left">
                    <label class="text-[8px] font-black uppercase tracking-widest text-gray-400">País / Región</label>
                    <select id="chk-country" class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs bg-gray-50 font-bold focus:border-black outline-none transition-all">
                        <option value="Bolivia">Bolivia</option>
                    </select>
                </div>

                <!-- Dirección -->
                <div class="relative text-left">
                    <input type="text" id="chk-address" value="${addressVal}" placeholder="Dirección (Calle, avenida, Nro.)" 
                           class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black transition-all font-medium">
                    <p class="text-[9px] text-red-500 font-bold mt-1 hidden" id="err-chk-address">Introduce una dirección</p>
                </div>

                <!-- Enlace Google Maps (Opcional) -->
                <div class="flex flex-col gap-1">
                    <div class="relative">
                        <input type="text" id="chk-maps-link" value="${mapsLinkVal}" placeholder="Enlace de ubicación en Google Maps (opcional)" 
                               class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black transition-all font-medium pr-10">
                        <i class="fa-solid fa-map-location-dot absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                    </div>
                    <p class="text-[8px] text-gray-400 font-bold px-1 text-left">Tip: Abre Google Maps, mantén presionado tu casa, copia el enlace y pégalo aquí.</p>
                </div>

                <!-- Descripción de Puerta / Fachada -->
                <div class="relative">
                    <input type="text" id="chk-door-desc" value="${doorDescVal}" placeholder="Descripción de tu fachada o puerta (ej. rejas blancas, puerta de metal negra, etc. - opcional)" 
                           class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black transition-all font-medium">
                </div>

                <!-- Campo apartamento removido por solicitud del cliente -->
            </div>

        </div>

        <!-- Métodos de Envío -->
        <div class="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4" id="checkout-shipping-section">
            <h2 class="text-xs font-black uppercase tracking-wider text-black text-left">Métodos de envío</h2>
            <div id="checkout-shipping-options">
                ${renderCheckoutShippingHTML(isInCoverageZone, state.storeConfig.shipping_options, deliveryZones)}
            </div>
        </div>

        <!-- Métodos de Pago -->
        <div class="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-3 text-left" id="checkout-payment-section">
            <h2 class="text-xs font-black uppercase tracking-wider text-black">Pago</h2>
            <p class="text-[10px] text-gray-400 font-bold">Todas las transacciones son seguras y están encriptadas.</p>
            <div id="checkout-payment-options">
                ${renderCheckoutPaymentHTML(isInCoverageZone, deliveryZones)}
            </div>
        </div>



        <!-- Botones en Mobile -->
        <div class="block lg:hidden pt-4 space-y-3">
            <button onclick="window.submitCheckoutForm()" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-2xl font-black text-xs tracking-wider uppercase transition-all flex items-center justify-center gap-3 shadow-lg active:scale-95">
                Finalizar el pedido
            </button>
            <button onclick="window.goBack()" class="w-full border-2 border-black bg-white text-black py-4.5 rounded-2xl font-black text-[10px] tracking-widest uppercase hover:bg-gray-50 transition-all flex items-center justify-center gap-2">
                <i class="fa-solid fa-chevron-left text-[9px]"></i> Volver a la bolsa
            </button>
        </div>

    </div>

    <!-- Columna Derecha: Resumen de Compra -->
    <div class="w-full lg:w-5/12 mt-8 lg:mt-0 order-1 lg:order-2">
        <div class="bg-gray-50/70 p-6 md:p-8 rounded-[2rem] border border-gray-150 sticky top-36 space-y-6">
            <h2 class="text-xs font-black uppercase tracking-wider text-black pb-3 border-b border-gray-200 text-left">Resumen del pedido</h2>
            
            <!-- Lista de Artículos -->
            <div class="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                ${state.cart.map(item => `
                    <div class="flex items-center justify-between gap-4">
                        <div class="flex items-center gap-3 text-left">
                            <div class="relative w-14 h-14 bg-white border border-gray-200 rounded-xl overflow-hidden flex-shrink-0">
                                <img src="${item.images[0]}" class="w-full h-full object-cover">
                                <span class="absolute -top-1.5 -right-1.5 bg-gray-500 text-white text-[9px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">${item.quantity}</span>
                            </div>
                            <div>
                                <h4 class="text-[10px] font-black uppercase text-black line-clamp-2 pr-2 leading-tight">${item.name}</h4>
                                <p class="text-[8px] text-gray-400 font-bold mt-0.5">BOB ${Number(item.price).toFixed(2)} c/u</p>
                            </div>
                        </div>
                        <span class="text-xs font-black text-black">BOB ${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                `).join('')}
            </div>
            
            <div class="border-t border-gray-200 pt-5 space-y-3">
                <!-- Subtotal -->
                <div class="flex justify-between items-center text-xs font-bold text-gray-500">
                    <span>Subtotal</span>
                    <span class="text-black">BOB ${subtotal.toFixed(2)}</span>
                </div>
                
                <!-- Envío -->
                <div class="flex justify-between items-center text-xs font-bold text-gray-500">
                    <span>Envío</span>
                    <span class="text-black font-black text-right" id="checkout-shipping-fee-text">${isInCoverageZone ? `BOB ${shippingCost.toFixed(2)}` : 'Por coordinar'}</span>
                </div>
                
                <!-- Impuestos -->
                <div class="flex justify-between items-center text-[10px] font-bold text-gray-400">
                    <span class="flex items-center gap-1">Impuestos estimados <i class="fa-regular fa-question-circle"></i></span>
                    <span>BOB 0.00</span>
                </div>
                
                <!-- Total general -->
                <div class="flex justify-between items-end border-t border-gray-200 pt-5 mt-2">
                    <div class="flex flex-col text-left">
                        <span class="text-xs font-black uppercase tracking-wider text-black">Total</span>
                        <span class="text-[8px] font-bold text-gray-400">Aranceles incluidos</span>
                    </div>
                    <span class="text-2xl font-black text-black tracking-tight" id="checkout-total-text">BOB ${(subtotal + shippingCost).toFixed(2)}</span>
                </div>
            </div>
            
            <!-- Botón Finalizar en Desktop -->
            <div class="hidden lg:block pt-4 space-y-3">
                <button onclick="window.submitCheckoutForm()" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-2xl font-black text-xs tracking-wider uppercase transition-all flex items-center justify-center gap-3 shadow-lg active:scale-95">
                    Finalizar el pedido
                </button>
                <p class="text-center mt-3 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                    Al finalizar el pedido aceptas nuestras <a href="#" onclick="event.preventDefault(); window.showPrivacyPolicy()" class="text-black hover:underline">Políticas de Privacidad</a>
                </p>
                <button onclick="window.goBack()" class="w-full border-2 border-black bg-white text-black py-4 mt-3 rounded-2xl font-black text-[10px] tracking-widest uppercase hover:bg-gray-50 transition-all flex items-center justify-center gap-2">
                    <i class="fa-solid fa-chevron-left text-[9px]"></i> Volver a la bolsa
                </button>
            </div>
        </div>
    </div>`;

    container.appendChild(wrapper);

    // Funciones dinámicas atadas al window para interactividad en tiempo real
    window.updateCheckoutShipping = (cost, radioEl) => {
        shippingCost = cost;
        const total = subtotal + shippingCost;
        
        // Actualizar visualmente los precios en el DOM
        const shipText = document.getElementById('checkout-shipping-fee-text');
        const totalText = document.getElementById('checkout-total-text');
        const citySelect = document.getElementById('chk-city');
        const userCity = citySelect ? citySelect.value : (state.selectedDepartment || 'Cochabamba');
        const deliveryZones = (state.storeConfig && state.storeConfig.delivery_zones) || ['Cochabamba'];
        const isCurrentInCoverage = deliveryZones.some(z =>
            userCity.toLowerCase().includes(z.toLowerCase()) || z.toLowerCase().includes(userCity.toLowerCase())
        );
        if (shipText) {
            if (!isCurrentInCoverage) {
                shipText.innerText = "Por coordinar";
            } else {
                shipText.innerText = cost === 0 ? "Gratis" : `BOB ${cost.toFixed(2)}`;
            }
        }
        if (totalText) totalText.innerText = `BOB ${total.toFixed(2)}`;
        
        // Estilizar las tarjetas de selección
        const allLabels = document.querySelectorAll('.lbl-ship-option');
        if (allLabels.length > 0) {
            allLabels.forEach(lbl => {
                lbl.classList.remove('bg-gray-50/10', 'border-black');
                lbl.classList.add('border-gray-200');
            });
            if (radioEl) {
                const parentLabel = radioEl.closest('.lbl-ship-option');
                if (parentLabel) {
                    parentLabel.classList.remove('border-gray-200');
                    parentLabel.classList.add('bg-gray-50/10', 'border-black');
                }
            } else {
                // Seleccionar el primero por defecto
                const firstOpt = allLabels[0];
                if (firstOpt) {
                    firstOpt.classList.remove('border-gray-200');
                    firstOpt.classList.add('bg-gray-50/10', 'border-black');
                }
            }
        }
    };

    window.selectSavedAddress = (val) => {
        if (val === 'new') {
            document.getElementById('chk-address-id').value = '';
            document.getElementById('chk-address').value = '';
            document.getElementById('chk-maps-link').value = '';
            document.getElementById('chk-door-desc').value = '';
            document.getElementById('chk-apartment').value = '';
            document.getElementById('chk-city').value = state.selectedDepartment || 'Cochabamba';
            document.getElementById('chk-address-label-container').classList.remove('hidden');
            document.getElementById('chk-address-label').value = '';
        } else {
            const addr = state.addresses[val];
            if (addr) {
                document.getElementById('chk-address-id').value = addr.id;
                document.getElementById('chk-address').value = addr.street || '';
                document.getElementById('chk-maps-link').value = addr.maps_link || '';
                document.getElementById('chk-door-desc').value = addr.door_description || '';
                document.getElementById('chk-apartment').value = addr.apartment || '';
                document.getElementById('chk-city').value = addr.city || '';
                document.getElementById('chk-address-label-container').classList.add('hidden');
            }
        }
    };
    window.updateCheckoutZone = (newZone) => {
        const deliveryZones = (state.storeConfig && state.storeConfig.delivery_zones) || ['Cochabamba'];
        const isInCoverageZone = deliveryZones.some(z =>
            newZone.toLowerCase().includes(z.toLowerCase()) || z.toLowerCase().includes(newZone.toLowerCase())
        );
        const shipSection = document.getElementById('checkout-shipping-options');
        const paySection = document.getElementById('checkout-payment-options');
        
        if (shipSection) shipSection.innerHTML = renderCheckoutShippingHTML(isInCoverageZone, state.storeConfig.shipping_options, deliveryZones);
        if (paySection) paySection.innerHTML = renderCheckoutPaymentHTML(isInCoverageZone, deliveryZones);

        // Actualizar el costo base (seleccionando la primera opción activa o carrier)
        const opts = state.storeConfig.shipping_options || [];
        const carrierCost = 0;
        let newCost = carrierCost;
        if (isInCoverageZone && opts.length > 0) {
            newCost = opts[0].price;
        }
        window.updateCheckoutShipping(newCost);

        // Mostrar u ocultar campos de dirección según cobertura
        const addressFields = document.getElementById('chk-address-fields');
        if (addressFields) {
            if (isInCoverageZone) {
                addressFields.classList.remove('hidden');
                addressFields.classList.add('space-y-4');
            } else {
                addressFields.classList.add('hidden');
                addressFields.classList.remove('space-y-4');
            }
        }

        // Limpiar errores visuales de campos que ahora son opcionales y ocultos
        if (!isInCoverageZone) {
            document.getElementById('err-chk-last-name')?.classList.add('hidden');
            document.getElementById('chk-last-name')?.classList.remove('border-red-500');
            document.getElementById('err-chk-address')?.classList.add('hidden');
            document.getElementById('chk-address')?.classList.remove('border-red-500');
        }
    };

    function renderCheckoutShippingHTML(inZone, options, zones) {
        if (!inZone) {
            return `
            <div class="border border-gray-200 rounded-2xl p-4 flex items-start gap-3 text-left">
                <div class="w-8 h-8 bg-gray-50 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                    <i class="fa-solid fa-truck text-black text-sm"></i>
                </div>
                <div>
                    <p class="text-xs font-black text-black uppercase tracking-wide">Envío por Transportadora <span class="text-red-500">*</span></p>
                    <p class="text-[10px] text-gray-500 font-medium mt-0.5 leading-relaxed">
                        Tu departamento no tiene cobertura de delivery local. El pedido se enviará por medio de una transportadora (encomienda) y el costo del envío se coordinará e informará internamente por WhatsApp.
                    </p>
                </div>
            </div>
            <input type="hidden" id="ship-express" name="shipping-method" value="carrier">
            `;
        }
        
        if (!options || options.length === 0) {
            // Fallback
            const sc = (state.storeConfig && state.storeConfig.shipping_cost) || 15;
            options = [
                { id: 1, title: 'Envío Express', description: 'A domicilio', price: sc },
                { id: 2, title: 'Retiro', description: 'Punto estratégico', price: 0 }
            ];
        }

        return `
            <div class="space-y-3">
                ${options.map((opt, idx) => `
                <label class="flex items-center justify-between p-4 border ${idx === 0 ? 'border-black bg-gray-50/10' : 'border-gray-200'} rounded-2xl cursor-pointer hover:border-black transition-all select-none text-left lbl-ship-option" data-price="${opt.price}">
                    <div class="flex items-center gap-3">
                        <input type="radio" name="shipping-method" id="${idx === 0 ? 'ship-express' : 'ship-opt-' + opt.id}" value="${opt.title}" ${idx === 0 ? 'checked' : ''} 
                               class="text-black focus:ring-black w-4 h-4" onchange="window.updateCheckoutShipping(${opt.price}, this)">
                        <div class="flex flex-col">
                            <span class="text-xs font-black text-black">${opt.title}</span>
                            <span class="text-[9px] text-gray-400 font-bold">${opt.description}</span>
                        </div>
                    </div>
                    <span class="text-xs font-black ${opt.price === 0 ? 'text-green-600' : 'text-black'}">${opt.price === 0 ? 'Gratis' : `BOB ${opt.price.toFixed(2)}`}</span>
                </label>
                `).join('')}
            </div>
        `;
    }

    function renderCheckoutPaymentHTML(inZone, zones) {
        const qrUrl = (state.storeConfig && state.storeConfig.qr_payment_url) || '';
        const hasQR = qrUrl.trim().length > 0;

        // Sección de imagen QR de pago (oculta por defecto, solo para encomiendas si hay QR configurado)
        const qrImageHTML = hasQR ? `
            <div id="checkout-qr-container" class="hidden mt-4 p-4 bg-gray-50 rounded-2xl border border-gray-100 text-center animate-fade">
                <p class="text-[9px] font-black uppercase tracking-wider text-gray-400 mb-3">Escanea para pagar</p>
                <div class="w-48 h-48 mx-auto bg-white border-2 border-gray-200 rounded-xl flex items-center justify-center overflow-hidden">
                    <img src="${qrUrl}" alt="QR de Pago" class="w-full h-full object-contain p-2">
                </div>
                <p class="text-[8px] text-gray-400 font-bold mt-2">Envía el comprobante por WhatsApp</p>
            </div>
        ` : '';

        // Definir la función global para alternar el QR
        window.toggleCheckoutQR = () => {
            if (!hasQR) return;
            const el = document.getElementById('checkout-qr-container');
            if (el) el.classList.toggle('hidden');
        };

        if (inZone) {
            return `
            <div class="p-4 border border-black bg-gray-50/20 rounded-2xl flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-4 h-4 rounded-full border border-black flex items-center justify-center bg-black">
                        <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
                    </div>
                    <div class="flex flex-col text-left">
                        <span class="text-xs font-black text-black">Pago contra entrega / Contra entrega</span>
                        <span class="text-[9px] text-gray-400 font-bold">Paga en efectivo o QR al recibir tu pedido</span>
                    </div>
                </div>
                <i class="fa-solid fa-money-bill-wave text-gray-600 text-sm"></i>
            </div>
            `;
        } else {
            const zonesText = Array.isArray(zones) && zones.length > 0 ? zones.join(', ') : 'Cochabamba';
            return `
            <div class="border border-gray-200 rounded-2xl p-4 mb-3 flex items-start gap-3">
                <i class="fa-solid fa-asterisk text-red-500 text-xs mt-0.5 flex-shrink-0"></i>
                <p class="text-[10px] font-bold text-gray-500 leading-relaxed">
                    Solo ofrecemos contra entrega en las sucursales principales (${zonesText}). Para tu departamento se requiere <span class="text-black font-black">pago previo obligatorio</span> antes del despacho.
                </p>
            </div>
            <div class="p-4 border border-black bg-gray-50/20 rounded-2xl flex items-center justify-between ${hasQR ? 'cursor-pointer active:scale-[0.99] transition-all' : ''}" ${hasQR ? 'onclick="window.toggleCheckoutQR()"' : ''}>
                <div class="flex items-center gap-3">
                    <div class="w-4 h-4 rounded-full border border-black flex items-center justify-center bg-black">
                        <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
                    </div>
                    <div class="flex flex-col text-left">
                        <span class="text-xs font-black text-black flex items-center gap-2">
                            Transferencia Bancaria / QR
                            ${hasQR ? `<span class="inline-flex items-center justify-center w-5 h-5 rounded bg-black text-white text-[9px] shadow-sm"><i class="fa-solid fa-qrcode"></i></span>` : ''}
                        </span>
                        <span class="text-[9px] text-gray-400 font-bold">Coordina el pago con el asesor por WhatsApp antes del envío</span>
                    </div>
                </div>
                <i class="fa-solid fa-qrcode text-gray-600 text-sm"></i>
            </div>
            ${qrImageHTML}
            `;
        }
    }

    window.submitCheckoutForm = async () => {
      try {
        // Campos
        const email = document.getElementById('chk-email').value.trim();
        const phone = document.getElementById('chk-phone').value.trim();
        const firstName = document.getElementById('chk-first-name').value.trim();
        const lastName = document.getElementById('chk-last-name').value.trim();
        const address = document.getElementById('chk-address').value.trim();
        const mapsLink = document.getElementById('chk-maps-link').value.trim();
        const doorDesc = document.getElementById('chk-door-desc').value.trim();
        const apartment = '';
        const city = document.getElementById('chk-city').value.trim();
        const shipExpressEl = document.getElementById('ship-express');
        const isExpress = shipExpressEl ? shipExpressEl.checked : false;
        // Get the selected shipping method name
        const selectedShipRadio = document.querySelector('input[name="shipping-method"]:checked');
        const selectedShipMethodName = selectedShipRadio ? selectedShipRadio.value : (isExpress ? 'Envío Express' : 'Transportadora');
        
        // Determinar si la zona actual tiene cobertura para validación condicional
        const currentCity = city;
        const currentDeliveryZones = (state.storeConfig && state.storeConfig.delivery_zones) || ['Cochabamba'];
        const currentInCoverage = currentDeliveryZones.some(z =>
            currentCity.toLowerCase().includes(z.toLowerCase()) || z.toLowerCase().includes(currentCity.toLowerCase())
        );

        // Validación
        let isValid = true;
        
        // Nombre (siempre obligatorio)
        if (!firstName) {
            document.getElementById('err-chk-first-name').classList.remove('hidden');
            document.getElementById('chk-first-name').classList.add('border-red-500');
            isValid = false;
        } else {
            document.getElementById('err-chk-first-name').classList.add('hidden');
            document.getElementById('chk-first-name').classList.remove('border-red-500');
        }
        
        // Correo (siempre obligatorio)
        if (!email || !email.includes('@')) {
            document.getElementById('err-chk-email').classList.remove('hidden');
            document.getElementById('chk-email').classList.add('border-red-500');
            isValid = false;
        } else {
            document.getElementById('err-chk-email').classList.add('hidden');
            document.getElementById('chk-email').classList.remove('border-red-500');
        }

        // Celular (siempre obligatorio)
        if (!phone) {
            document.getElementById('err-chk-phone').classList.remove('hidden');
            document.getElementById('chk-phone').classList.add('border-red-500');
            isValid = false;
        } else {
            document.getElementById('err-chk-phone').classList.add('hidden');
            document.getElementById('chk-phone').classList.remove('border-red-500');
        }
        
        // Apellido (obligatorio solo en zona de cobertura)
        if (currentInCoverage && !lastName) {
            document.getElementById('err-chk-last-name').classList.remove('hidden');
            document.getElementById('chk-last-name').classList.add('border-red-500');
            isValid = false;
        } else {
            document.getElementById('err-chk-last-name').classList.add('hidden');
            document.getElementById('chk-last-name').classList.remove('border-red-500');
        }
        
        // Dirección (obligatoria solo en zona de cobertura)
        if (currentInCoverage && !address) {
            document.getElementById('err-chk-address').classList.remove('hidden');
            document.getElementById('chk-address').classList.add('border-red-500');
            isValid = false;
        } else {
            document.getElementById('err-chk-address').classList.add('hidden');
            document.getElementById('chk-address').classList.remove('border-red-500');
        }
        
        // Ciudad (siempre obligatorio)
        if (!city) {
            document.getElementById('err-chk-city').classList.remove('hidden');
            document.getElementById('chk-city').classList.add('border-red-500');
            isValid = false;
        } else {
            document.getElementById('err-chk-city').classList.add('hidden');
            document.getElementById('chk-city').classList.remove('border-red-500');
        }
        
        if (!isValid) {
            showNotification("Por favor, llena los campos obligatorios.");
            return;
        }
        
        // Bloquear botón para evitar doble envío y mostrar progreso
        const submitBtn = document.querySelector('button[onclick="window.submitCheckoutForm()"]');
        const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch animate-spin"></i> Procesando...';
            submitBtn.disabled = true;
            submitBtn.classList.add('opacity-70', 'cursor-not-allowed');
        }
        
        // Mostrar overlay global
        let loaderOverlay = document.getElementById('global-checkout-loader');
        if (!loaderOverlay) {
            loaderOverlay = document.createElement('div');
            loaderOverlay.id = 'global-checkout-loader';
            loaderOverlay.className = 'fixed inset-0 z-[999] bg-white/95 backdrop-blur-md flex flex-col items-center justify-center animate-fade';
            loaderOverlay.innerHTML = `
                <div class="w-24 h-24 bg-white rounded-[2rem] flex items-center justify-center mb-8 shadow-2xl animate-pulse overflow-hidden border border-gray-100">
                    <img src="assets/logo.png" alt="Logo Emma Store" class="w-16 h-16 object-contain">
                </div>
                <h3 class="text-3xl font-black uppercase tracking-tighter text-black mb-3">Procesando Pedido</h3>
                <p class="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2 bg-gray-100 py-2 px-4 rounded-full">
                    <i class="fa-solid fa-circle-notch animate-spin text-black"></i> Validando...
                </p>
            `;
            document.body.appendChild(loaderOverlay);
        } else {
            loaderOverlay.classList.remove('hidden');
        }
        
        // Guardar información en Supabase (si está logueado) o en caché (si es visitante)
        if (state.user && supabaseClient) {
            // Upsert Profile
            supabaseClient.from('profiles').upsert({
                id: state.user.id,
                full_name: firstName + ' ' + lastName,
                phone: phone,
                email: email,
                updated_at: new Date()
            }).then(res => {
                if (!res.error) {
                    state.user.name = firstName + ' ' + lastName;
                    state.user.phone = phone;
                }
            });

            // Update or Insert Address
            const selectedAddressId = document.getElementById('chk-address-id')?.value;
            if (selectedAddressId) {
                const original = state.addresses.find(a => a.id == selectedAddressId);
                if (original && (original.street !== address || original.city !== city || original.maps_link !== mapsLink || original.door_description !== doorDesc || original.apartment !== apartment)) {
                    supabaseClient.from('addresses').update({
                        street: address,
                        city: city,
                        maps_link: mapsLink,
                        door_description: doorDesc,
                        apartment: apartment,
                        updated_at: new Date()
                    }).eq('id', selectedAddressId).then(() => loadUserAddresses());
                }
            } else {
                supabaseClient.from('addresses').insert({
                    user_id: state.user.id,
                    label: document.getElementById('chk-address-label')?.value.trim() || 'CASA',
                    street: address,
                    city: city,
                    maps_link: mapsLink,
                    door_description: doorDesc,
                    apartment: apartment,
                    is_default: state.addresses.length === 0
                }).then(() => loadUserAddresses());
            }
        } else {
            const checkoutCache = {
                email,
                phone,
                first_name: firstName,
                last_name: lastName,
                address,
                maps_link: mapsLink,
                door_desc: doorDesc,
                apartment,
                city,
                save_info: true
            };
            localStorage.setItem('emma_store_checkout_cache', JSON.stringify(checkoutCache));
        }
        
        // Asignar vendedor aleatorio
        const sc = {}; 
        state.cart.forEach(i => sc[i.contactId] = (sc[i.contactId] || 0) + i.quantity);
        const max = Math.max(...Object.values(sc));
        const wins = Object.keys(sc).filter(sid => sc[sid] === max);
        const seller = state.contacts.find(c => c.id == wins[Math.floor(Math.random() * wins.length)]) || state.contacts[0] || { name: 'Ventas', number: '' };
        
        // Formatear mensaje para WhatsApp
        const shippingFeeText = shippingCost;
        const totalCost = subtotal + shippingFeeText;
        
        let m = "✨ *EMMA STORE - NUEVO PEDIDO* ✨\n";
        m += "━━━━━━━━━━━━━━━━━━━━━\n\n";
        
        m += "👤 *CONTACTO Y CLIENTE:*\n";
        m += `   └─ Nombre: ${firstName ? firstName + ' ' : ''}${lastName}\n`;
        m += `   └─ Correo: ${email}\n`;
        m += `   └─ Celular: ${phone}\n\n`;
        
        m += "📍 *ENTREGA Y DIRECCIÓN:*\n";
        m += `   └─ Ciudad/Depto: ${city}\n`;
        if (currentInCoverage) {
            m += `   └─ Dirección: ${address}\n`;
            if (apartment) {
                m += `   └─ Detalle/Piso: ${apartment}\n`;
            }
            if (doorDesc) {
                m += `   └─ Fachada/Puerta: ${doorDesc}\n`;
            }
            if (mapsLink) {
                m += `   └─ Google Maps: ${mapsLink}\n`;
            }
        } else {
            m += `   └─ *Envío a provincia / exterior de sucursal*\n`;
        }
        m += "\n";
        
        const shippingFeeDisplay = currentInCoverage ? `BOB ${shippingFeeText.toFixed(2)}` : '*Por coordinar*';
        const totalDisplay = currentInCoverage ? `BOB ${totalCost.toFixed(2)}` : `BOB ${subtotal.toFixed(2)} + envío por coordinar`;
        
        m += "🚚 *MÉTODO DE ENVÍO:*\n";
        m += `   └─ ${selectedShipMethodName} (${shippingFeeDisplay})\n\n`;
        
        m += "🛍️ *PRODUCTOS DEL PEDIDO:*\n";
        state.cart.forEach(item => {
            m += `   └─ ${item.name.toUpperCase()} (Cant: ${item.quantity}) | BOB ${(item.price * item.quantity).toFixed(2)}\n`;
        });
        m += "\n";
        
        m += "━━━━━━━━━━━━━━━━━━━━━\n";
        m += `💵 Subtotal: BOB ${subtotal.toFixed(2)}\n`;
        m += `🚚 Envío: ${shippingFeeDisplay}\n`;
        m += `💰 *TOTAL A PAGAR: ${totalDisplay}*\n`;
        m += "━━━━━━━━━━━━━━━━━━━━━\n\n";
        m += `💵 *Método de Pago:* ${currentInCoverage ? 'Pago contra entrega' : '⚠️ *Transferencia Bancaria / QR (Previo Pago)*'}\n`;
        if (!currentInCoverage) {
            m += "\n⚠️ *NOTA:* El costo de envío por encomienda está *Pendiente de Coordinación* y se te informará para realizar el pago correspondiente antes del despacho.";
        }
        
        // Mostrar spinner/bloqueo de botón opcional aquí (asumiremos rápido para UX local)
        
        // Guardar pedido en Supabase
        const orderNumber = "EMMA-" + Math.random().toString(36).substr(2, 6).toUpperCase();
        
        const formattedItems = state.cart.map(item => {
            let cleanId = item.id;
            if (typeof cleanId === 'string') {
                if (cleanId.startsWith('prod_')) {
                    cleanId = parseInt(cleanId.replace('prod_', ''));
                } else if (cleanId.startsWith('promo_')) {
                    cleanId = parseInt(cleanId.replace('promo_', ''));
                } else {
                    cleanId = parseInt(cleanId);
                }
            } else {
                cleanId = parseInt(cleanId);
            }
            return {
                id: isNaN(cleanId) ? null : cleanId,
                product_id: isNaN(cleanId) ? null : cleanId,
                product_name: item.name,
                product_image: item.images && item.images.length ? item.images[0] : item.image || '',
                quantity: item.quantity,
                price: item.price
            };
        });

        if (state.supabaseSession) {
            // Usuario autenticado: guardar con su user_id
            try {
                await fetch('/api/user/orders', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...getAuthHeaders()
                    },
                    body: JSON.stringify({
                        order_number: orderNumber,
                        subtotal: subtotal,
                        shipping_cost: shippingFeeText,
                        total: totalCost,
                        shipping_method: selectedShipMethodName || (isExpress ? 'express' : 'free'),
                        contact_name: `${firstName} ${lastName}`.trim(),
                        contact_email: email,
                        contact_phone: phone,
                        shipping_address: address,
                        shipping_city: city,
                        shipping_department: state.selectedDepartment,
                        shipping_maps_link: mapsLink,
                        shipping_door_desc: doorDesc,
                        shipping_apartment: apartment,
                        seller_name: seller.name,
                        seller_number: seller.number?.toString(),
                        items: formattedItems
                    })
                });
            } catch (err) {
                console.error('Error guardando pedido en Supabase:', err);
                showNotification("Hubo un error al procesar tu pedido. Intenta nuevamente.");
                if (submitBtn) {
                    submitBtn.innerHTML = originalBtnHtml;
                    submitBtn.disabled = false;
                    submitBtn.classList.remove('opacity-70', 'cursor-not-allowed');
                }
                if (document.getElementById('global-checkout-loader')) {
                    document.getElementById('global-checkout-loader').classList.add('hidden');
                }
                return;
            }
        } else {
            // Modo visitante: Guardar en base de datos sin usuario y enviar correo
            try {
                await fetch('/api/public/orders', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        orderData: {
                            order_number: orderNumber,
                            contact_email: email,
                            contact_name: `${firstName} ${lastName}`.trim(),
                            contact_phone: phone,
                            subtotal: subtotal,
                            shipping_cost: shippingFeeText,
                            total: totalCost,
                            shipping_method: selectedShipMethodName || (isExpress ? 'express' : 'free'),
                            shipping_address: address,
                            shipping_city: city,
                            shipping_department: state.selectedDepartment,
                            shipping_maps_link: mapsLink,
                            shipping_door_desc: doorDesc,
                            shipping_apartment: apartment,
                            seller_name: seller.name,
                            seller_number: seller.number?.toString()
                        },
                        items: formattedItems
                    })
                });
            } catch (err) {
                console.error('Error guardando pedido de visitante:', err);
                showNotification("Hubo un error al procesar tu pedido. Intenta nuevamente.");
                if (submitBtn) {
                    submitBtn.innerHTML = originalBtnHtml;
                    submitBtn.disabled = false;
                    submitBtn.classList.remove('opacity-70', 'cursor-not-allowed');
                }
                if (document.getElementById('global-checkout-loader')) {
                    document.getElementById('global-checkout-loader').classList.add('hidden');
                }
                return;
            }
        }
            
            // Fallback: también guardar en localStorage
            const newOrder = {
                id: orderNumber,
                date: new Date().toLocaleString('es-BO', { timeZone: 'America/La_Paz' }),
                items: [...state.cart],
                subtotal: subtotal,
                shipping: shippingFeeText,
                total: totalCost,
                status: 'confirmado'
            };
            const currentOrders = JSON.parse(localStorage.getItem('emma_store_orders')) || [];
            currentOrders.unshift(newOrder);
            localStorage.setItem('emma_store_orders', JSON.stringify(currentOrders));

        // Limpiar carrito al enviar pedido
        state.cart = [];
        updateCartUI();
        
        const sellerPhone = (seller && seller.number) ? seller.number.toString().replace(/\D/g, '') : '';
        const waUrl = sellerPhone ? `https://wa.me/${sellerPhone}?text=${encodeURIComponent(m)}` : '#';
        
        renderCheckoutSuccess(orderNumber, waUrl, newOrder.items);
      } catch (globalErr) {
        console.error('Error crítico en submitCheckoutForm:', globalErr);
        showNotification('Error al procesar tu pedido: ' + globalErr.message);
        const loader = document.getElementById('global-checkout-loader');
        if (loader) loader.remove();
        const allBtns = document.querySelectorAll('button[onclick="window.submitCheckoutForm()"]');
        allBtns.forEach(btn => {
            btn.innerHTML = 'Finalizar el pedido';
            btn.disabled = false;
            btn.classList.remove('opacity-70', 'cursor-not-allowed');
        });
      }
    };
}

function renderCheckoutSuccess(orderNumber, waUrl, items = []) {
    const loader = document.getElementById('global-checkout-loader');
    if (loader) loader.remove();
    
    const container = document.getElementById('main-view');
    window.scrollTo(0, 0);
    
    container.innerHTML = `
    <div class="max-w-2xl mx-auto px-4 py-20 text-center animate-fade">
        <div class="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
            <i class="fa-solid fa-check text-4xl text-green-500"></i>
        </div>
        
        <h1 class="text-3xl md:text-5xl font-black uppercase tracking-tighter mb-4 text-black">Pedido Procesado</h1>
        <p class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Tu pedido ha sido registrado con éxito.</p>
        <p class="text-lg font-black text-black bg-gray-50 py-3 px-6 rounded-xl inline-block mb-8 border border-gray-200">#${orderNumber}</p>
        
        <div class="bg-gray-50 rounded-3xl p-6 mb-10 text-left border border-gray-100 shadow-sm max-w-md mx-auto">
            <h3 class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 border-b border-gray-200 pb-2">Productos (${items.length})</h3>
            <div class="space-y-3">
                ${items.map(item => `
                    <div class="flex justify-between items-center">
                        <div class="flex gap-3 items-center">
                            ${item.image ? `<img src="${item.image}" class="w-10 h-10 rounded-lg object-cover">` : `<div class="w-10 h-10 bg-gray-200 rounded-lg"></div>`}
                            <span class="text-xs font-black uppercase max-w-[150px] truncate">${item.name}</span>
                        </div>
                        <div class="text-right">
                            <p class="text-[9px] font-bold text-gray-400">x${item.quantity}</p>
                            <p class="text-xs font-black">BOB ${(item.price * item.quantity).toFixed(2)}</p>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="space-y-4 flex flex-col items-center">
            <button onclick="window.navigate('home')" class="w-full md:w-auto px-12 py-5 bg-black text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-900 transition-all active:scale-95 shadow-xl">
                Volver al menú principal
            </button>
            
            ${waUrl !== '#' ? `
            <button onclick="window.openWhatsAppRedirect()" class="mt-6 text-[10px] font-bold text-gray-400 hover:text-green-500 transition-colors uppercase tracking-widest flex items-center justify-center gap-2 bg-transparent border-none cursor-pointer">
                <i class="fa-brands fa-whatsapp text-sm"></i> Escríbenos por WhatsApp
            </button>
            ` : ''}
        </div>
    </div>`;

    // Modal de redirección automática
    if (waUrl !== '#') {
        const modalId = 'wa-redirect-modal';
        let modal = document.getElementById(modalId);
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'fixed inset-0 z-[150] flex items-center justify-center p-4 transition-all duration-300 opacity-0 pointer-events-none';
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300"></div>
            <div class="relative bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl scale-95 transition-transform duration-300 border border-gray-100 flex flex-col text-center" id="wa-redirect-card">
                
                <div class="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-sm text-green-500">
                    <i class="fa-brands fa-whatsapp text-3xl"></i>
                </div>
                
                <h3 class="text-xs font-black uppercase tracking-wider text-black mb-3">Redirigir a WhatsApp</h3>
                
                <p class="text-xs font-bold text-gray-500 uppercase tracking-widest leading-relaxed mb-6">
                    Tu pedido ha sido registrado.<br>
                    Haz clic en <span class="text-black font-black">Continuar</span> para enviar el detalle del pedido a nuestro WhatsApp y coordinar la entrega.
                </p>
                
                <div class="flex gap-3">
                    <button id="wa-redirect-cancel" class="flex-1 border-2 border-gray-200 bg-white text-gray-400 py-3.5 rounded-2xl font-black text-[10px] tracking-widest uppercase hover:bg-gray-50 transition-all cursor-pointer">
                        Cancelar
                    </button>
                    <button id="wa-redirect-confirm" class="flex-1 bg-green-500 hover:bg-green-600 text-white py-3.5 rounded-2xl font-black text-[10px] tracking-widest uppercase transition-all shadow-lg active:scale-95 cursor-pointer">
                        Continuar
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Animación de entrada
        requestAnimationFrame(() => {
            modal.classList.remove('opacity-0', 'pointer-events-none');
            const card = document.getElementById('wa-redirect-card');
            if (card) {
                card.classList.remove('scale-95');
                card.classList.add('scale-100');
            }
        });

        const closeModal = () => {
            modal.classList.add('opacity-0', 'pointer-events-none');
            const card = document.getElementById('wa-redirect-card');
            if (card) {
                card.classList.remove('scale-100');
                card.classList.add('scale-95');
            }
            setTimeout(() => modal.remove(), 300);
        };

        // Guardar la función global para abrir el modal si cierran y quieren volver a abrir
        window.openWhatsAppRedirect = () => {
            renderCheckoutSuccess(orderNumber, waUrl, items);
        };

        document.getElementById('wa-redirect-cancel').onclick = () => {
            closeModal();
        };

        document.getElementById('wa-redirect-confirm').onclick = () => {
            closeModal();
            window.open(waUrl, '_blank');
        };
    }
}

window.askInfo = (id) => {
    const isPromo = typeof id === 'string' && id.startsWith('promo_');
    const isProd = typeof id === 'string' && id.startsWith('prod_');
    
    let realId = id;
    let isPromoItem = isPromo;
    
    if (isPromo) {
        realId = parseInt(id.replace('promo_', ''));
    } else if (isProd) {
        realId = parseInt(id.replace('prod_', ''));
    } else {
        realId = parseInt(id);
    }
    
    const cartId = isPromoItem ? `promo_${realId}` : `prod_${realId}`;
    const p = isPromoItem 
        ? state.promotions.find(x => x.id === realId)
        : state.products.find(x => x.id === realId);
        
    if (!p) return;

    // Crear el modal dinámicamente
    const modalId = 'quick-order-confirm-modal';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'fixed inset-0 z-[150] flex items-center justify-center p-4 transition-all duration-300 opacity-0 pointer-events-none';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300"></div>
        <div class="relative bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl scale-95 transition-transform duration-300 border border-gray-100 flex flex-col text-center" id="quick-order-card">
            
            <div class="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-sm text-blue-600">
                <i class="fa-solid fa-bolt text-2xl"></i>
            </div>
            
            <h3 class="text-xs font-black uppercase tracking-wider text-black mb-3">Pedido Rápido</h3>
            
            <p class="text-xs font-bold text-gray-500 uppercase tracking-widest leading-relaxed mb-6">
                El precio de este artículo es <span class="text-black font-black">BOB ${Number(p.price).toFixed(2)}</span>.<br>
                ¿Quieres continuar rellenando los datos?
            </p>
            
            <div class="flex gap-3">
                <button id="quick-order-cancel" class="flex-1 border-2 border-gray-200 bg-white text-gray-400 py-3.5 rounded-2xl font-black text-[10px] tracking-widest uppercase hover:bg-gray-50 transition-all cursor-pointer">
                    Cancelar
                </button>
                <button id="quick-order-confirm" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-2xl font-black text-[10px] tracking-widest uppercase transition-all shadow-lg active:scale-95 cursor-pointer">
                    Continuar
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Animación de entrada
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0', 'pointer-events-none');
        const card = document.getElementById('quick-order-card');
        if (card) {
            card.classList.remove('scale-95');
            card.classList.add('scale-100');
        }
    });

    const closeModal = () => {
        modal.classList.add('opacity-0', 'pointer-events-none');
        const card = document.getElementById('quick-order-card');
        if (card) {
            card.classList.remove('scale-100');
            card.classList.add('scale-95');
        }
        setTimeout(() => modal.remove(), 300);
    };

    // Eventos
    document.getElementById('quick-order-cancel').onclick = () => {
        closeModal();
    };

    document.getElementById('quick-order-confirm').onclick = () => {
        closeModal();
        const inCart = state.cart.find(x => x.id === cartId);
        if (!inCart) {
            state.cart.push({ ...p, id: cartId, quantity: 1 });
            updateCartUI();
        }
        window.toggleCart(false);
        window.checkout();
    };
};

// --- ATAJOS TECLADO ---
document.addEventListener('keydown', (e) => {
    if (e.key === "Escape") { window.closeLightbox(); }
    if (e.key === "ArrowRight") { window.nextImg(); }
    if (e.key === "ArrowLeft") { window.prevImg(); }
});

// --- VISTAS DE PERFIL Y PEDIDOS ---
function renderProfile(container) {
    if (!state.user) {
        window.navigate('home');
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = "max-w-md mx-auto px-6 py-10 animate-fade text-black text-left";

    // Card 1: Nombre y Email
    let nameHtml = '';
    if (state.isEditingName) {
        nameHtml = `
            <div class="flex flex-col gap-1.5 mt-2">
                <input type="text" id="edit-profile-name-input" value="${state.user.name}" 
                       class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black font-semibold">
                <div class="flex gap-2 justify-end mt-1">
                    <button onclick="window.cancelProfileName()" class="px-4 py-2 border border-gray-200 rounded-lg text-[9px] font-black uppercase tracking-wider text-gray-500 hover:bg-gray-50 cursor-pointer">Cancelar</button>
                    <button onclick="window.saveProfileName()" class="px-4 py-2 bg-black text-white rounded-lg text-[9px] font-black uppercase tracking-wider hover:bg-gray-900 cursor-pointer">Guardar</button>
                </div>
            </div>
        `;
    } else {
        nameHtml = `
            <div class="flex justify-between items-center mt-2 bg-gray-50/50 border border-gray-100 rounded-xl p-3.5">
                <span class="text-xs font-bold text-gray-700">${state.user.name}</span>
                <button onclick="window.startEditingName()" class="text-blue-600 hover:text-blue-700 p-1.5 cursor-pointer bg-transparent border-none">
                    <i class="fa-solid fa-pencil text-xs"></i>
                </button>
            </div>
        `;
    }

    // Card 2: Direcciones (múltiples desde Supabase)
    let addressesHtml = '';
    
    if (state.isEditingAddress) {
        const editAddr = state.editingAddressId ? state.addresses.find(a => a.id === state.editingAddressId) : null;
        addressesHtml = `
            <div class="space-y-3 mt-3">
                <div class="relative">
                    <input type="text" id="edit-addr-label" value="${editAddr?.label || 'Casa'}" placeholder="Etiqueta (Ej: Casa, Trabajo)" 
                           class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black font-medium">
                </div>
                <input type="text" id="edit-addr-street" value="${editAddr?.street || ''}" placeholder="Dirección (Calle, avenida, Nro. de casa)" 
                       class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black font-medium">
                <input type="text" id="edit-addr-apartment" value="${editAddr?.apartment || ''}" placeholder="Casa, departamento, piso (opcional)" 
                       class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black font-medium">
                <div class="grid grid-cols-2 gap-3">
                    <input type="text" id="edit-addr-city" value="${editAddr?.city || ''}" placeholder="Ciudad" 
                           class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black font-medium">
                    <input type="text" id="edit-addr-department" value="${editAddr?.department || state.selectedDepartment}" placeholder="Departamento" 
                           class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black font-medium">
                </div>
                <div class="relative">
                    <input type="text" id="edit-addr-maps" value="${editAddr?.maps_link || ''}" placeholder="Enlace de Google Maps (opcional)" 
                           class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black font-medium pr-10">
                    <i class="fa-solid fa-map-location-dot absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                </div>
                <input type="text" id="edit-addr-door" value="${editAddr?.door_description || ''}" placeholder="Descripción de fachada o puerta (opcional)" 
                       class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black font-medium">
                <label class="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" id="edit-addr-default" ${editAddr?.is_default ? 'checked' : ''} class="rounded border-gray-300 text-black focus:ring-black w-4 h-4">
                    <span class="text-[10px] text-gray-500 font-bold">Marcar como dirección predeterminada</span>
                </label>
                <div class="flex gap-2 justify-end mt-2">
                    <button onclick="window.cancelProfileAddress()" class="px-4 py-2 border border-gray-200 rounded-lg text-[9px] font-black uppercase tracking-wider text-gray-500 hover:bg-gray-50 cursor-pointer">Cancelar</button>
                    <button onclick="window.saveProfileAddress()" class="px-4 py-2 bg-black text-white rounded-lg text-[9px] font-black uppercase tracking-wider hover:bg-gray-900 cursor-pointer">Guardar</button>
                </div>
            </div>
        `;
    } else if (state.addresses.length === 0) {
        addressesHtml = `
            <div class="mt-3 bg-gray-50/50 border border-gray-100 rounded-xl p-4 text-left">
                <p class="text-xs font-bold text-gray-400 italic">No hay direcciones configuradas.</p>
            </div>
        `;
    } else {
        addressesHtml = state.addresses.map(addr => `
            <div class="mt-3 bg-gray-50/50 border border-gray-100 rounded-xl p-4 relative text-left ${addr.is_default ? 'border-black' : ''}">
                <div class="flex justify-between items-start mb-2">
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] font-black uppercase text-gray-400 tracking-wider">${addr.label || 'Dirección'}</span>
                        ${addr.is_default ? '<span class="bg-black text-white text-[7px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">Predeterminada</span>' : ''}
                    </div>
                    <div class="flex items-center gap-1">
                        <button onclick="window.startEditingAddress(${addr.id})" class="text-blue-600 hover:text-blue-700 p-1 cursor-pointer bg-transparent border-none">
                            <i class="fa-solid fa-pencil text-xs"></i>
                        </button>
                        <button onclick="window.deleteAddress(${addr.id})" class="text-red-400 hover:text-red-600 p-1 cursor-pointer bg-transparent border-none">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </div>
                </div>
                <p class="text-xs font-semibold text-gray-700 leading-relaxed">${addr.street}</p>
                ${addr.apartment ? `<p class="text-xs font-semibold text-gray-700 leading-relaxed">${addr.apartment}</p>` : ''}
                <p class="text-xs font-semibold text-gray-700 leading-relaxed">${addr.city}, ${addr.department || ''}</p>
                ${addr.maps_link ? `<a href="${addr.maps_link}" target="_blank" class="text-[10px] text-blue-600 font-bold hover:underline flex items-center gap-1 mt-1"><i class="fa-solid fa-map-location-dot"></i> Ver en Google Maps</a>` : ''}
                ${addr.door_description ? `<p class="text-[10px] text-gray-400 font-bold mt-1"><i class="fa-solid fa-door-open text-[8px]"></i> ${addr.door_description}</p>` : ''}
            </div>
        `).join('');
    }

    wrapper.innerHTML = `
        <h1 class="text-2xl font-black uppercase tracking-tight mb-8 text-black">Perfil</h1>
        
        <!-- Tarjeta de Datos de Usuario -->
        <div class="bg-white border border-gray-150 rounded-3xl p-6 shadow-sm mb-6">
            <h3 class="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Nombre</h3>
            ${nameHtml}
            
            <h3 class="text-[9px] font-black uppercase tracking-widest text-gray-400 mt-5 mb-1">Correo electrónico</h3>
            <p class="text-xs font-bold text-gray-700 bg-gray-50 border border-gray-150 rounded-xl p-3.5 select-all leading-none mt-2 truncate">${state.user.email}</p>
        </div>

        <!-- Tarjeta de Direcciones -->
        <div class="bg-white border border-gray-150 rounded-3xl p-6 shadow-sm mb-8">
            <div class="flex justify-between items-center">
                <h3 class="text-[9px] font-black uppercase tracking-widest text-gray-400">Direcciones</h3>
                ${!state.isEditingAddress ? `<button onclick="window.startEditingAddress()" class="text-blue-600 hover:text-blue-700 text-xs font-bold flex items-center gap-1 select-none cursor-pointer bg-transparent border-none"><i class="fa-solid fa-plus text-[10px]"></i> Agregar</button>` : ''}
            </div>
            ${addressesHtml}
        </div>

        <!-- Botones de Acción -->
        <div class="space-y-4">
            <button onclick="window.logoutAndGoHome()" class="w-full bg-white border border-gray-200 text-black py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 active:scale-95 transition-all text-center select-none cursor-pointer">
                Cerrar sesión
            </button>
        </div>

        <div class="text-center mt-12">
            <a href="#" onclick="event.preventDefault(); window.showPrivacyPolicy()" class="text-[10px] font-bold text-blue-600 hover:underline">Política de privacidad</a>
        </div>
    `;

    container.appendChild(wrapper);
}

async function renderOrders(container) {
    if (!state.user) {
        window.navigate('home');
        return;
    }
    
    const wrapper = document.createElement('div');
    wrapper.className = "max-w-md mx-auto px-6 py-10 animate-fade text-black text-left";
    
    // Mostrar loading mientras carga
    wrapper.innerHTML = `
        <h1 class="text-2xl font-black uppercase tracking-tight mb-8 text-black">Mis Pedidos</h1>
        <div class="flex justify-center py-16">
            <div class="w-8 h-8 border-[3px] border-black border-t-transparent rounded-full animate-spin"></div>
        </div>
    `;
    container.appendChild(wrapper);
    
    // Cargar pedidos desde Supabase
    let orders = [];
    if (state.supabaseSession) {
        try {
            const res = await fetch('/api/user/orders', {
                headers: { ...getAuthHeaders() }
            });
            if (res.ok) {
                orders = await res.json();
            }
        } catch (err) { 
            console.error('Error cargando pedidos:', err); 
        }
    }
    
    // Fallback a localStorage si no hay pedidos de Supabase
    if (orders.length === 0) {
        orders = (JSON.parse(localStorage.getItem('emma_store_orders')) || []).map(o => ({
            ...o,
            order_number: o.id,
            shipping_cost: o.shipping || 0,
            created_at: o.date,
            order_items: (o.items || []).map(item => ({
                product_name: item.name,
                product_image: item.images ? item.images[0] : '',
                price: item.price,
                quantity: item.quantity
            }))
        }));
    }
    
    const statusColors = {
        'confirmado': 'bg-blue-50 text-blue-700 border-blue-100',
        'en_proceso': 'bg-yellow-50 text-yellow-700 border-yellow-100',
        'enviado': 'bg-purple-50 text-purple-700 border-purple-100',
        'entregado': 'bg-green-50 text-green-700 border-green-100',
        'cancelado': 'bg-red-50 text-red-700 border-red-100'
    };
    
    const statusLabels = {
        'confirmado': 'Confirmado',
        'en_proceso': 'En Proceso',
        'enviado': 'Enviado',
        'entregado': 'Entregado',
        'cancelado': 'Cancelado'
    };
    
    if (orders.length === 0) {
        wrapper.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 text-center">
                <div class="w-16 h-16 bg-gray-50 border border-gray-150 rounded-full flex items-center justify-center text-gray-400 mb-6">
                    <i class="fa-solid fa-box-open text-xl"></i>
                </div>
                <h2 class="text-sm font-black uppercase tracking-wider text-black mb-2">Sin pedidos aún</h2>
                <p class="text-xs text-gray-400 font-bold mb-8 max-w-[250px]">Tus compras realizadas se registrarán aquí automáticamente.</p>
                <button onclick="window.navigate('home')" class="bg-black text-white px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-900 transition-all select-none active:scale-95 cursor-pointer">
                    Volver al catálogo
                </button>
            </div>
        `;
    } else {
        const orderDate = (order) => {
            if (order.created_at && !isNaN(Date.parse(order.created_at))) {
                return new Date(order.created_at).toLocaleString('es-BO', { timeZone: 'America/La_Paz' });
            }
            return order.created_at || order.date || '';
        };
        
        wrapper.innerHTML = `
            <h1 class="text-2xl font-black uppercase tracking-tight mb-8 text-black">Mis Pedidos</h1>
            
            <div class="space-y-6 animate-fade">
                ${orders.map(order => {
                    const items = order.order_items || [];
                    const statusClass = statusColors[order.status] || statusColors['confirmado'];
                    const statusLabel = statusLabels[order.status] || order.status;
                    
                    return `
                    <div class="bg-white border border-gray-150 rounded-3xl p-5 shadow-sm space-y-4">
                        <div class="flex justify-between items-start pb-3 border-b border-gray-100">
                            <div>
                                <h4 class="text-xs font-black text-black">Pedido #${order.order_number || order.id}</h4>
                                <p class="text-[9px] text-gray-400 font-bold mt-1">${orderDate(order)}</p>
                            </div>
                            <span class="${statusClass} text-[8px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider border">${statusLabel}</span>
                        </div>
                        
                        <!-- Listado de ítems -->
                        <div class="space-y-3">
                            ${items.map(item => `
                                <div class="flex items-center gap-3 text-left">
                                    ${item.product_image ? `<img src="${item.product_image}" class="w-9 h-9 object-cover rounded-lg border border-gray-100 flex-shrink-0">` : `<div class="w-9 h-9 rounded-lg bg-gray-100 border flex-shrink-0"></div>`}
                                    <div class="min-w-0 flex-1">
                                        <p class="text-[10px] font-black uppercase text-black truncate leading-tight">${item.product_name || item.name}</p>
                                        <p class="text-[8px] text-gray-400 font-bold mt-0.5">Cant: ${item.quantity} | BOB ${(Number(item.price) * item.quantity).toFixed(2)}</p>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        
                        <div class="flex justify-between items-end pt-3 border-t border-gray-100 text-xs">
                            <span class="text-gray-400 font-bold">Total a pagar</span>
                            <span class="font-black text-black text-sm">BOB ${Number(order.total).toFixed(2)}</span>
                        </div>
                    </div>
                `}).join('')}
            </div>
            
            <button onclick="window.navigate('home')" class="w-full mt-10 border-2 border-black bg-white text-black py-4.5 rounded-2xl font-black text-[10px] tracking-widest uppercase hover:bg-gray-50 transition-all text-center select-none active:scale-95 cursor-pointer">
                Volver al catálogo
            </button>
        `;
    }
}

window.logoutAndGoHome = () => {
    window.logout();
    window.navigate('home');
};

window.startEditingName = () => {
    state.isEditingName = true;
    render();
};

window.cancelProfileName = () => {
    state.isEditingName = false;
    render();
};

window.saveProfileName = async () => {
    const input = document.getElementById('edit-profile-name-input');
    const newName = input ? input.value.trim() : '';
    if (newName && state.user) {
        state.user.name = newName;
        updateAccountUI();
        
        // Guardar en Supabase
        if (state.supabaseSession) {
            try {
                await fetch('/api/user/profile', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    body: JSON.stringify({ full_name: newName })
                });
            } catch (err) { console.error('Error guardando nombre:', err); }
        }
        
        showNotification("Nombre actualizado");
    }
    state.isEditingName = false;
    render();
};

window.startEditingAddress = (addressId = null) => {
    state.isEditingAddress = true;
    state.editingAddressId = addressId;
    render();
};

window.cancelProfileAddress = () => {
    state.isEditingAddress = false;
    state.editingAddressId = null;
    render();
};

window.saveProfileAddress = async () => {
    const street = document.getElementById('edit-addr-street')?.value.trim();
    const apartment = document.getElementById('edit-addr-apartment')?.value.trim();
    const city = document.getElementById('edit-addr-city')?.value.trim();
    const department = document.getElementById('edit-addr-department')?.value.trim();
    const label = document.getElementById('edit-addr-label')?.value.trim() || 'Casa';
    const mapsLink = document.getElementById('edit-addr-maps')?.value.trim();
    const doorDesc = document.getElementById('edit-addr-door')?.value.trim();
    const isDefault = document.getElementById('edit-addr-default')?.checked || false;
    
    if (!street || !city) {
        showNotification("Dirección y ciudad son obligatorios");
        return;
    }
    
    if (!state.supabaseSession) return;
    
    const body = {
        label,
        street,
        apartment,
        city,
        department: department || state.selectedDepartment,
        country: 'Bolivia',
        maps_link: mapsLink,
        door_description: doorDesc,
        is_default: isDefault
    };
    
    try {
        const method = state.editingAddressId ? 'PUT' : 'POST';
        const url = state.editingAddressId 
            ? `/api/user/addresses/${state.editingAddressId}` 
            : '/api/user/addresses';
        
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(body)
        });
        
        if (res.ok) {
            showNotification(state.editingAddressId ? "Dirección actualizada" : "Dirección agregada");
            await loadUserAddresses();
        } else {
            showNotification("Error al guardar dirección");
        }
    } catch (err) { 
        console.error('Error guardando dirección:', err);
        showNotification("Error de conexión");
    }
    
    state.isEditingAddress = false;
    state.editingAddressId = null;
    render();
};

window.deleteAddress = async (addressId) => {
    if (!confirm("¿Eliminar esta dirección?")) return;
    if (!state.supabaseSession) return;
    
    try {
        const res = await fetch(`/api/user/addresses/${addressId}`, {
            method: 'DELETE',
            headers: { ...getAuthHeaders() }
        });
        if (res.ok) {
            showNotification("Dirección eliminada");
            await loadUserAddresses();
            render();
        }
    } catch (err) { console.error('Error eliminando dirección:', err); }
};

// --- FILTROS DE BÚSQUEDA ---
window.openFilterDrawer = () => {
    const drawer = document.getElementById('filter-drawer');
    const backdrop = document.getElementById('filter-drawer-backdrop');
    const card = document.getElementById('filter-drawer-card');
    if (!drawer || !backdrop || !card) return;

    if (window.filterDrawerCloseTimeout) {
        clearTimeout(window.filterDrawerCloseTimeout);
        window.filterDrawerCloseTimeout = null;
    }

    // Populate inputs from state.filters
    const sortSelect = document.getElementById('filter-sort');
    const availableCheckbox = document.getElementById('filter-available');
    const minInput = document.getElementById('price-min-input');
    const maxInput = document.getElementById('price-max-input');
    const minRange = document.getElementById('price-min-range');
    const maxRange = document.getElementById('price-max-range');

    if (sortSelect) sortSelect.value = state.filters.sort;
    if (availableCheckbox) availableCheckbox.checked = state.filters.availableOnly;

    // Determine min/max values from products
    const prices = state.products.map(p => p.price);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 1000;

    if (minRange) {
        minRange.min = minPrice;
        minRange.max = maxPrice;
        minRange.value = state.filters.currentMin;
    }
    if (maxRange) {
        maxRange.min = minPrice;
        maxRange.max = maxPrice;
        maxRange.value = state.filters.currentMax;
    }
    if (minInput) {
        minInput.value = Math.round(state.filters.currentMin);
    }
    if (maxInput) {
        maxInput.value = Math.round(state.filters.currentMax);
    }

    window.updateSliderTrack();
    window.updateFilterCount();

    // Show container first
    drawer.classList.remove('invisible');

    // Force browser reflow
    drawer.offsetHeight;

    // Animate opacity & translate
    backdrop.classList.remove('opacity-0');
    backdrop.classList.add('opacity-100');

    card.classList.remove('translate-y-full', 'sm:scale-95');
    card.classList.add('translate-y-0', 'sm:scale-100');
};

window.closeFilterDrawer = () => {
    const drawer = document.getElementById('filter-drawer');
    const backdrop = document.getElementById('filter-drawer-backdrop');
    const card = document.getElementById('filter-drawer-card');
    if (!drawer || !backdrop || !card) return;

    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0');

    card.classList.remove('translate-y-0', 'sm:scale-100');
    card.classList.add('translate-y-full', 'sm:scale-95');

    window.filterDrawerCloseTimeout = setTimeout(() => {
        drawer.classList.add('invisible');
    }, 500);
};

window.togglePriceAccordion = () => {
    const content = document.getElementById('price-filter-content');
    const caret = document.getElementById('price-caret');
    if (!content || !caret) return;

    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        caret.classList.remove('rotate-180');
    } else {
        content.classList.add('hidden');
        caret.classList.add('rotate-180');
    }
};

window.updateSliderTrack = () => {
    const minRange = document.getElementById('price-min-range');
    const maxRange = document.getElementById('price-max-range');
    const track = document.getElementById('price-slider-track');
    if (!minRange || !maxRange || !track) return;

    const minVal = parseFloat(minRange.value) || 0;
    const maxVal = parseFloat(maxRange.value) || 0;
    const minLimit = parseFloat(minRange.min) || 0;
    const maxLimit = parseFloat(maxRange.max) || 1000;
    const rangeDiff = maxLimit - minLimit || 1;

    const leftPercent = ((minVal - minLimit) / rangeDiff) * 100;
    const rightPercent = 100 - (((maxVal - minLimit) / rangeDiff) * 100);

    track.style.left = `${leftPercent}%`;
    track.style.right = `${rightPercent}%`;
};

window.updateMinFromRange = () => {
    const minRange = document.getElementById('price-min-range');
    const maxRange = document.getElementById('price-max-range');
    const minInput = document.getElementById('price-min-input');
    if (!minRange || !maxRange || !minInput) return;

    let minVal = parseFloat(minRange.value) || 0;
    const maxVal = parseFloat(maxRange.value) || 0;

    if (minVal > maxVal) {
        minVal = maxVal;
        minRange.value = maxVal;
    }

    minInput.value = Math.round(minVal);
    window.updateSliderTrack();
    window.updateFilterCount();
};

window.updateMaxFromRange = () => {
    const minRange = document.getElementById('price-min-range');
    const maxRange = document.getElementById('price-max-range');
    const maxInput = document.getElementById('price-max-input');
    if (!minRange || !maxRange || !maxInput) return;

    const minVal = parseFloat(minRange.value) || 0;
    let maxVal = parseFloat(maxRange.value) || 0;

    if (maxVal < minVal) {
        maxVal = minVal;
        maxRange.value = minVal;
    }

    maxInput.value = Math.round(maxVal);
    window.updateSliderTrack();
    window.updateFilterCount();
};

window.updateMinFromInput = () => {
    const minRange = document.getElementById('price-min-range');
    const maxRange = document.getElementById('price-max-range');
    const minInput = document.getElementById('price-min-input');
    if (!minRange || !maxRange || !minInput) return;

    let minVal = parseFloat(minInput.value) || 0;
    const maxVal = parseFloat(maxRange.value) || 0;
    const minLimit = parseFloat(minRange.min) || 0;

    if (minVal < minLimit) minVal = minLimit;
    if (minVal > maxVal) minVal = maxVal;

    minRange.value = minVal;
    window.updateSliderTrack();
    window.updateFilterCount();
};

window.updateMaxFromInput = () => {
    const minRange = document.getElementById('price-min-range');
    const maxRange = document.getElementById('price-max-range');
    const maxInput = document.getElementById('price-max-input');
    if (!minRange || !maxRange || !maxInput) return;

    const minVal = parseFloat(minRange.value) || 0;
    let maxVal = parseFloat(maxInput.value) || 0;
    const maxLimit = parseFloat(maxRange.max) || 1000;

    if (maxVal > maxLimit) maxVal = maxLimit;
    if (maxVal < minVal) maxVal = minVal;

    maxRange.value = maxVal;
    window.updateSliderTrack();
    window.updateFilterCount();
};

window.getFilteredProducts = (customFilters = null) => {
    const filters = customFilters || state.filters;
    let list = [...state.products];

    // Filter by category
    if (state.selectedCategory !== 'todas') {
        list = list.filter(p => p.categoryId == state.selectedCategory);
    }

    // Filter by search query
    if (state.searchQuery) {
        list = list.filter(p => 
            (p.name && p.name.toLowerCase().includes(state.searchQuery)) ||
            (p.description && p.description.toLowerCase().includes(state.searchQuery))
        );
    }

    // Filter by availability
    if (filters.availableOnly) {
        list = list.filter(p => p.inStock);
    }

    // Filter by price
    const minPrice = parseFloat(filters.currentMin);
    const maxPrice = parseFloat(filters.currentMax);
    if (!isNaN(minPrice)) {
        list = list.filter(p => p.price >= minPrice);
    }
    if (!isNaN(maxPrice)) {
        list = list.filter(p => p.price <= maxPrice);
    }

    // Sorting
    if (filters.sort === 'recent') {
        list.sort((a, b) => b.id - a.id);
    } else if (filters.sort === 'old') {
        list.sort((a, b) => a.id - b.id);
    } else if (filters.sort === 'price-asc') {
        list.sort((a, b) => a.price - b.price);
    } else if (filters.sort === 'price-desc') {
        list.sort((a, b) => b.price - a.price);
    }

    return list;
};

window.updateFilterCount = () => {
    const sortSelect = document.getElementById('filter-sort');
    const availableCheckbox = document.getElementById('filter-available');
    const minInput = document.getElementById('price-min-input');
    const maxInput = document.getElementById('price-max-input');
    const resultsBtn = document.getElementById('btn-filter-results');

    if (!resultsBtn) return;

    const tempFilters = {
        sort: sortSelect ? sortSelect.value : 'recent',
        availableOnly: availableCheckbox ? availableCheckbox.checked : false,
        currentMin: minInput ? parseFloat(minInput.value) || 0 : 0,
        currentMax: maxInput ? parseFloat(maxInput.value) || 1000 : 1000
    };

    const count = window.getFilteredProducts(tempFilters).length;
    resultsBtn.textContent = `Ver resultados (${count})`;
};

window.applyFilters = () => {
    const sortSelect = document.getElementById('filter-sort');
    const availableCheckbox = document.getElementById('filter-available');
    const minInput = document.getElementById('price-min-input');
    const maxInput = document.getElementById('price-max-input');

    state.filters.sort = sortSelect ? sortSelect.value : 'recent';
    state.filters.availableOnly = availableCheckbox ? availableCheckbox.checked : false;
    state.filters.currentMin = minInput ? parseFloat(minInput.value) || 0 : 0;
    state.filters.currentMax = maxInput ? parseFloat(maxInput.value) || 1000 : 1000;

    window.closeFilterDrawer();
    render();
};

window.clearFilters = () => {
    const prices = state.products.map(p => p.price);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 1000;

    const sortSelect = document.getElementById('filter-sort');
    const availableCheckbox = document.getElementById('filter-available');
    const minInput = document.getElementById('price-min-input');
    const maxInput = document.getElementById('price-max-input');
    const minRange = document.getElementById('price-min-range');
    const maxRange = document.getElementById('price-max-range');

    if (sortSelect) sortSelect.value = 'recent';
    if (availableCheckbox) availableCheckbox.checked = false;
    if (minRange) minRange.value = minPrice;
    if (maxRange) maxRange.value = maxPrice;
    if (minInput) minInput.value = Math.round(minPrice);
    if (maxInput) maxInput.value = Math.round(maxPrice);

    window.updateSliderTrack();
    window.updateFilterCount();
};

window.initScrollReveal = () => {
    const cards = document.querySelectorAll('.product-card');
    if (!('IntersectionObserver' in window)) {
        cards.forEach(c => c.classList.add('visible'));
        return;
    }

    const observerOptions = {
        root: null,
        rootMargin: '0px 0px -40px 0px',
        threshold: 0.02
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                entry.target.classList.remove('exit-down');
            } else {
                const rect = entry.target.getBoundingClientRect();
                // Element exited the viewport to the bottom (meaning user scrolled up)
                if (rect.top > (window.innerHeight || document.documentElement.clientHeight) - 50) {
                    entry.target.classList.remove('visible');
                    entry.target.classList.add('exit-down');
                }
            }
        });
    }, observerOptions);

    cards.forEach(card => {
        observer.observe(card);
    });
};

window.initCategoryCarousel = (carouselEl) => {
    if (!carouselEl) return;
    let animationFrameId = null;
    let isPaused = false;
    let scrollSpeed = 0.5; // slow, premium rotation speed

    // Initialize position so it doesn't wrap instantly on frame 1
    carouselEl.scrollLeft = carouselEl.scrollWidth - carouselEl.clientWidth;

    const scrollFn = () => {
        if (!document.body.contains(carouselEl)) {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            return;
        }

        if (!isPaused) {
            carouselEl.scrollLeft -= scrollSpeed;
            if (carouselEl.scrollLeft <= 0.5) {
                carouselEl.scrollLeft = carouselEl.scrollWidth - carouselEl.clientWidth;
            }
        }
        animationFrameId = requestAnimationFrame(scrollFn);
    };

    const pause = () => { isPaused = true; };
    const resume = () => { isPaused = false; };

    carouselEl.addEventListener('mouseenter', pause);
    carouselEl.addEventListener('mouseleave', resume);
    carouselEl.addEventListener('touchstart', pause);
    carouselEl.addEventListener('touchend', resume);

    // If user interacts via scroll, pause scroller temporarily
    let interactionTimeout = null;
    carouselEl.addEventListener('scroll', () => {
        isPaused = true;
        if (interactionTimeout) clearTimeout(interactionTimeout);
        interactionTimeout = setTimeout(() => {
            isPaused = false;
        }, 3000); // 3 seconds timeout
    });

    animationFrameId = requestAnimationFrame(scrollFn);
};

// --- MODO OSCURO (DARK MODE) ---
window.toggleDarkMode = () => {
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('emma_theme', isDark ? 'dark' : 'light');
    updateThemeIcon(isDark);
};

function updateThemeIcon(isDark) {
    const icon = document.getElementById('theme-icon');
    if (icon) {
        if (isDark) {
            icon.className = 'fa-solid fa-sun text-xs md:text-sm text-yellow-400';
        } else {
            icon.className = 'fa-regular fa-moon text-xs md:text-sm text-black';
        }
    }
}

function initTheme() {
    const savedTheme = localStorage.getItem('emma_theme');
    const isDark = savedTheme === 'dark';
    if (isDark) {
        document.body.classList.add('dark');
    } else {
        document.body.classList.remove('dark');
    }
    updateThemeIcon(isDark);
}

// Inicializar el tema de inmediato
initTheme();

window.onload = () => {
    initTheme();
    loadData();
};
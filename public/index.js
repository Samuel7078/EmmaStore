// --- SUPABASE CLIENT ---
let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';
let supabaseClient = null;

// --- ESTADO GLOBAL ---
const state = {
    view: 'home',
    products: [],
    categories: [],
    contacts: [],
    stories: [],
    cart: JSON.parse(localStorage.getItem('emma_store_cart')) || [],
    selectedCategory: 'todas',
    selectedProduct: null,
    detailActiveImg: 0,
    detailSlideInterval: null,
    userInteractionTimeout: null,
    searchQuery: '',
    // Estado para Historias
    activeStoryIndex: -1,
    storyTimer: null,
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
    }
};

// --- HELPER: Auth Token para API ---
function getAuthHeaders() {
    if (!state.supabaseSession) return {};
    return { 'Authorization': `Bearer ${state.supabaseSession.access_token}` };
}

// --- MOTOR DE DATOS ---
async function loadData() {
    try {
        // Cargar datos de productos (MySQL/Aiven)
        const [p, cat, con, s] = await Promise.all([
            fetch('/api/products').then(r => r.json()),
            fetch('/api/categories').then(r => r.json()),
            fetch('/api/contacts').then(r => r.json()),
            fetch('/api/stories').then(r => r.json())
        ]);
        state.products = p.map(prod => ({ 
            ...prod, 
            price: parseFloat(prod.price) || 0,
            inStock: true 
        }));
        state.categories = cat;
        state.contacts = con;
        state.stories = s;
        
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
                    state.user = {
                        id: session.user.id,
                        name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || '',
                        email: session.user.email || '',
                        photo: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || ''
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
    }
}

// --- VISOR DE HISTORIAS (ESTILO INSTAGRAM) ---
window.openStory = (index) => {
    state.activeStoryIndex = index;
    const story = state.stories[index];
    if (!story) return;

    let viewer = document.getElementById('story-viewer');
    if (!viewer) {
        viewer = document.createElement('div');
        viewer.id = 'story-viewer';
        viewer.className = "fixed inset-0 z-[3000] bg-black flex items-center justify-center animate-fade";
        viewer.innerHTML = `
            <div class="absolute top-0 left-0 w-full h-1.5 flex gap-1 p-2 z-10" id="story-progress-container"></div>
            <button onclick="window.closeStory()" class="absolute top-8 right-6 z-20 text-white text-3xl">&times;</button>
            
            <div class="absolute inset-y-0 left-0 w-1/4 z-10 cursor-pointer" onclick="window.prevStory()"></div>
            <div class="absolute inset-y-0 right-0 w-1/4 z-10 cursor-pointer" onclick="window.nextStory()"></div>

            <div class="relative w-full h-full max-w-lg overflow-hidden flex items-center justify-center">
                <img id="story-img" class="w-full h-full object-cover">
                <div class="absolute bottom-10 left-0 w-full p-6 bg-gradient-to-t from-black/80 to-transparent text-white">
                    <p id="story-vendor" class="text-xs font-black uppercase tracking-widest mb-1"></p>
                    <p id="story-msg" class="text-[10px] opacity-70"></p>
                </div>
            </div>
        `;
        document.body.appendChild(viewer);
    }
    
    viewer.classList.remove('hidden');
    updateStoryUI();
};

function updateStoryUI() {
    const story = state.stories[state.activeStoryIndex];
    const vendor = state.contacts.find(c => c.id == story.contactId);
        
    document.getElementById('story-img').src = story.imageUrl;
    document.getElementById('story-vendor').innerText = "Emma Store";
    document.getElementById('story-msg').innerText = story.customMsg || "Novedades exclusivas";

    // Renderizar barras de progreso
    const progressContainer = document.getElementById('story-progress-container');
    progressContainer.innerHTML = state.stories.map((_, i) => `
        <div class="h-full flex-1 bg-white/20 rounded-full overflow-hidden">
            <div class="h-full bg-white transition-all linear" 
                 id="bar-${i}" 
                 style="width: ${i < state.activeStoryIndex ? '100%' : '0%'}">
            </div>
        </div>
    `).join('');

    startStoryTimer();
}

function startStoryTimer() {
    clearTimeout(state.storyTimer);
    const currentBar = document.getElementById(`bar-${state.activeStoryIndex}`);
    
    // Resetear barra actual
    currentBar.style.transition = 'none';
    currentBar.style.width = '0%';
    
    setTimeout(() => {
        // Duración de la historia: 5000ms (5 segundos)
        currentBar.style.transition = 'width 5000ms linear';
        currentBar.style.width = '100%';
    }, 50);

    state.storyTimer = setTimeout(() => {
        window.nextStory();
    }, 5050);
}

window.nextStory = () => {
    if (state.activeStoryIndex < state.stories.length - 1) {
        state.activeStoryIndex++;
        updateStoryUI();
    } else {
        window.closeStory();
    }
};

window.prevStory = () => {
    if (state.activeStoryIndex > 0) {
        state.activeStoryIndex--;
        updateStoryUI();
    }
};

window.closeStory = () => {
    clearTimeout(state.storyTimer);
    document.getElementById('story-viewer')?.classList.add('hidden');
    state.activeStoryIndex = -1;
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
                        <button onclick="changeCartQty(${i.id}, -1)" class="text-gray-400 hover:text-black font-bold text-xs">－</button>
                        <span class="text-[10px] font-black">${i.quantity}</span>
                        <button onclick="changeCartQty(${i.id}, 1)" class="text-gray-400 hover:text-black font-bold text-xs">＋</button>
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
    const p = state.products.find(x => x.id == id);
    const e = state.cart.find(x => x.id == id);
    if (e) e.quantity += qty; else state.cart.push({ ...p, quantity: qty });
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

window.showPrivacyPolicy = () => {
    const modal = document.getElementById('privacy-policy-modal');
    const card = document.getElementById('privacy-policy-card');
    if (modal && card) {
        modal.classList.remove('invisible', 'opacity-0');
        card.classList.remove('scale-90');
        card.classList.add('scale-100');
    }
};

window.closePrivacyPolicy = () => {
    const modal = document.getElementById('privacy-policy-modal');
    const card = document.getElementById('privacy-policy-card');
    if (modal && card) {
        card.classList.remove('scale-100');
        card.classList.add('scale-90');
        setTimeout(() => {
            modal.classList.add('invisible', 'opacity-0');
        }, 150);
    }
};

window.updateLoginButtonsState = () => {
    const isChecked = document.getElementById('privacy-accept-checkbox')?.checked;
    const btnGoogle = document.getElementById('btn-login-google');
    const btnGuest = document.getElementById('btn-login-guest');
    
    if (btnGoogle && btnGuest) {
        if (isChecked) {
            btnGoogle.disabled = false;
            btnGoogle.classList.remove('opacity-50', 'cursor-not-allowed');
            btnGoogle.classList.add('active:scale-95', 'hover:bg-gray-900');
            
            btnGuest.disabled = false;
            btnGuest.classList.remove('opacity-50', 'cursor-not-allowed');
            btnGuest.classList.add('active:scale-95', 'hover:bg-gray-50');
        } else {
            btnGoogle.disabled = true;
            btnGoogle.classList.add('opacity-50', 'cursor-not-allowed');
            btnGoogle.classList.remove('active:scale-95', 'hover:bg-gray-900');
            
            btnGuest.disabled = true;
            btnGuest.classList.add('opacity-50', 'cursor-not-allowed');
            btnGuest.classList.remove('active:scale-95', 'hover:bg-gray-50');
        }
    }
};

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
                ${state.user.photo ? `<img src="${state.user.photo}" class="w-6 h-6 rounded-full border border-gray-200 object-cover">` : `<i class="fa-regular fa-user text-xs md:text-sm text-black"></i>`}
                <div class="hidden sm:flex flex-col items-start leading-[1.1] text-left">
                    <span class="text-[9px] font-black uppercase tracking-wider text-gray-400">Hola, ${firstName}</span>
                    <span class="text-xs font-black text-black">Mi Cuenta</span>
                </div>
            `;
        } else {
            accountBtn.innerHTML = `
                <i class="fa-regular fa-user text-xs md:text-sm text-black"></i>
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
    const view = urlParams.get('view') || 'home';
    const category = urlParams.get('category') || 'todas';
    const productId = urlParams.get('product');
    const search = urlParams.get('search') || '';

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
}

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
    
    const params = new URLSearchParams();
    params.set('view', 'home');
    if (id !== 'todas') {
        params.set('category', id);
    }
    if (state.searchQuery) {
        params.set('search', state.searchQuery);
    }

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    history.pushState({
        view: 'home',
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
    } else {
        params.delete('search');
    }
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    
    history.replaceState({
        ...history.state,
        searchQuery: query,
        scrollY: window.scrollY
    }, "", newUrl);

    render();
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

function render() {
    const main = document.getElementById('main-view');
    if(!main) return;
    main.innerHTML = '';
    
    // Ocultar buscador móvil en vistas secundarias
    const mobileSearchBar = document.getElementById('mobile-search-bar');
    if (mobileSearchBar && state.view !== 'home') {
        mobileSearchBar.classList.add('hidden');
    }

    if (state.view === 'home') {
        renderStories(main);
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

// --- VISTAS ESPECÍFICAS ---
function renderStories(container) {
    const div = document.createElement('div');
    div.className = "max-w-7xl mx-auto px-6 py-6 flex gap-6 overflow-x-auto no-scrollbar animate-fade overscroll-x-contain scroll-smooth";
    div.innerHTML = state.stories.map((s, index) => `
        <div class="flex-shrink-0 text-center cursor-pointer group" onclick="window.openStory(${index})">
            <div class="w-16 h-16 rounded-full p-[2px] story-ring transition-transform duration-300 active:scale-95 group-hover:scale-105">
                <img src="${s.imageUrl}" class="w-full h-full object-cover rounded-full">
            </div>
            <p class="text-[8px] font-black uppercase mt-2 opacity-50 tracking-wider text-black">Ver</p>
        </div>
    `).join('');
    if (state.stories.length > 0) container.appendChild(div);
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

    // 1. Featured Category Block at the very top (first element)
    let featuredCategoryHTML = '';
    if (state.categories.length > 0) {
        let featuredCat = null;
        let featuredCatProducts = [];
        // Stable search based on filtered products length
        const catOffset = filtered.length % state.categories.length;
        for (let i = 0; i < state.categories.length; i++) {
            const idx = (catOffset + i) % state.categories.length;
            const cat = state.categories[idx];
            const prods = state.products.filter(p => p.categoryId == cat.id);
            if (prods.length > 0) {
                featuredCat = cat;
                featuredCatProducts = prods;
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
                        <div class="w-32 md:w-44 flex-shrink-0 flex flex-col justify-between cursor-pointer" onclick="navigate('detail', ${p.id})">
                            <div class="aspect-[3/4] overflow-hidden bg-white rounded-2xl md:rounded-[2rem] border border-gray-100 shadow-sm relative mb-3">
                                <img src="${p.images[0]}" class="w-full h-full object-cover transition-transform duration-500 hover:scale-105">
                            </div>
                            <div class="px-1 text-left">
                                <h4 class="text-[9px] md:text-xs font-black uppercase text-black line-clamp-1 leading-tight mb-1">${p.name}</h4>
                                <span class="text-[10px] md:text-xs font-black text-black">BS ${p.price}</span>
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
            return `
            <div class="product-card group relative col-span-2 lg:col-span-4 bg-gray-50/50 border border-gray-100 rounded-[2rem] md:rounded-[3rem] p-4 md:p-6 flex gap-4 md:gap-8 items-center h-auto justify-between">
                <!-- Left Image -->
                <div class="w-28 md:w-44 aspect-[3/4] overflow-hidden bg-white rounded-[1.5rem] md:rounded-[2rem] relative cursor-pointer shadow-sm border border-gray-100 flex-shrink-0" 
                     onclick="navigate('detail', ${p.id})">
                    <img src="${p.images[0]}" onload="this.classList.remove('opacity-0')" class="product-image w-full h-full object-cover transition-all duration-700 opacity-0">
                </div>
                <!-- Right Info -->
                <div class="flex-1 flex flex-col justify-between py-1 text-left self-stretch">
                    <div>
                        <span class="text-[8px] font-black uppercase text-gray-400 tracking-widest">${categoryLabel}</span>
                        <h3 class="text-xs md:text-xl font-black uppercase text-black mt-1 mb-1.5 line-clamp-2 leading-tight">${p.name}</h3>
                        <p class="text-[9px] md:text-xs text-gray-400 font-bold line-clamp-3 mb-3 leading-relaxed">${p.description || 'Sin descripción disponible.'}</p>
                        <span class="text-xs md:text-lg font-black text-black block mb-3">BS ${p.price}</span>
                    </div>
                    <div class="flex flex-col sm:flex-row gap-2 mt-auto">
                        <button onclick="addToCart(${p.id})" class="bg-black text-white px-4 py-2.5 rounded-xl text-[8px] md:text-[10px] font-black uppercase tracking-wider hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm border-none cursor-pointer">
                            <i class="fa-solid fa-plus"></i> Añadir
                        </button>
                        <button onclick="navigate('detail', ${p.id})" class="bg-white border border-gray-200 text-black px-4 py-2.5 rounded-xl text-[8px] md:text-[10px] font-black uppercase tracking-wider hover:bg-gray-50 active:scale-95 transition-all cursor-pointer">
                            Ver más
                        </button>
                    </div>
                </div>
            </div>`;
        }

        return `
        <div class="product-card group relative flex flex-col justify-between ${isOutOfStock ? 'opacity-80' : ''}">
            <div>
                <div class="aspect-[3/4] overflow-hidden bg-gray-50 rounded-[1.75rem] md:rounded-[2.5rem] mb-4 md:mb-6 relative cursor-pointer shadow-sm border border-gray-100" 
                     onmouseenter="${isOutOfStock ? '' : `startCatalogHoverSlide(this, '${encodeURIComponent(JSON.stringify(p.images))}')`}" 
                     onmouseleave="${isOutOfStock ? '' : `stopCatalogHoverSlide(this, '${p.images[0]}')`}"
                     onclick="navigate('detail', ${p.id})">
                    <img src="${p.images[0]}" onload="this.classList.remove('opacity-0')" class="product-image w-full h-full object-cover transition-all duration-700 opacity-0">
                    
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
                <div class="flex justify-between items-start px-1 mb-4">
                    <div class="pr-2">
                        <h3 class="text-[10px] md:text-xs font-black uppercase text-black line-clamp-1 leading-tight mb-1">${p.name}</h3>
                        <p class="text-[8px] font-bold opacity-40 text-black tracking-widest">${categoryLabel}</p>
                    </div>
                    <span class="text-xs md:text-sm font-black text-black whitespace-nowrap">BS ${p.price}</span>
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
}

function renderDetail(container) {
    const p = state.selectedProduct;
    const cat = state.categories.find(c => c.id == p.categoryId);
    const categoryLabel = cat ? cat.name.toUpperCase() : 'COLECCIÓN';

    container.innerHTML = `
    <div class="max-w-7xl mx-auto px-6 py-6 md:py-12 lg:flex gap-16 animate-fade">
        <div class="lg:w-1/2 mb-8 lg:mb-0">
            <div class="relative aspect-square bg-gray-50 rounded-[2rem] md:rounded-[3.5rem] overflow-hidden shadow-inner border border-gray-100 cursor-zoom-in group" onclick="openLightbox()">
                <!-- Botón Volver Flotante en Imagen (Móviles) -->
                <button onclick="event.stopPropagation(); window.goBack()" 
                        class="md:hidden absolute top-4 left-4 z-10 w-10 h-10 bg-white/90 backdrop-blur-md text-black rounded-full flex items-center justify-center shadow-md active:scale-90 transition-all border border-gray-100">
                    <i class="fa-solid fa-chevron-left text-sm"></i>
                </button>

                <img id="detail-main-img" src="${p.images[state.detailActiveImg]}" class="w-full h-full object-cover transition-all duration-500">
                
                <div class="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/40 backdrop-blur-md text-white px-4 py-2 rounded-full text-[8px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                    Click para pantalla completa
                </div>
            </div>
            <div class="flex gap-3 mt-4 md:mt-6 overflow-x-auto no-scrollbar overscroll-x-contain scroll-smooth">
                ${p.images.map((img, i) => `
                    <button onclick="changeDetailImg(${i}, true)" 
                            class="thumb-btn flex-shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-xl md:rounded-2xl border-2 transition-all overflow-hidden ${i === state.detailActiveImg ? 'border-black opacity-100' : 'border-transparent opacity-50'}">
                        <img src="${img}" class="w-full h-full object-cover">
                    </button>
                `).join('')}
            </div>
        </div>
        <div class="lg:w-1/2 flex flex-col justify-center">
            <p class="text-[10px] font-black opacity-30 uppercase tracking-[0.3em] mb-2">Emma Store Bolivia • ${categoryLabel}</p>
            <h1 class="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-black uppercase tracking-tighter mb-4 text-black leading-none">${p.name}</h1>
            <p class="text-2xl md:text-3xl font-black mb-6 text-black">BS ${p.price}</p>
            
            <div class="mb-8 md:mb-10">
                <h4 class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Descripción</h4>
                <p class="text-sm leading-relaxed text-gray-600 font-medium">${p.description || 'Este producto exclusivo de Emma Store no cuenta con una descripción detallada en este momento.'}</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 md:mb-6">
                <button onclick="addToCart(${p.id})" class="bg-black text-white py-4 md:py-5 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-md hover:bg-gray-900 transition-all active:scale-95">Añadir a la bolsa</button>
                <button onclick="askInfo(${p.id})" class="bg-green-500 text-white py-4 md:py-5 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-md flex items-center justify-center gap-3 active:scale-95 transition-all">
                    <i class="fa-brands fa-whatsapp text-xl"></i> Consultar Stock
                </button>
            </div>
            <button onclick="window.goBack()" class="w-full py-4 md:py-5 border-2 border-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-50 transition-all active:scale-95 flex items-center justify-center gap-2">
                <i class="fa-solid fa-arrow-left"></i> Volver al catálogo
            </button>
        </div>
    </div>`;
}

// --- MOTOR WHATSAPP ---
window.checkout = (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (state.cart.length === 0) return alert("Bolsa vacía");

    // GANCHO DE AUTENTICACIÓN
    if (!state.user && !state.isGuest) {
        window.openLoginHookModal(() => window.checkout());
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
    
    // Pre-llenar valores
    const emailVal = cache.email || (state.user ? state.user.email : '');
    const phoneVal = cache.phone || '';
    const firstNameVal = cache.first_name || (state.user ? state.user.name.split(' ')[0] : '');
    const lastNameVal = cache.last_name || (state.user ? state.user.name.split(' ').slice(1).join(' ') : '');
    const addressVal = cache.address || '';
    const mapsLinkVal = cache.maps_link || '';
    const doorDescVal = cache.door_desc || '';
    const apartmentVal = cache.apartment || '';
    const cityVal = cache.city || state.selectedDepartment || 'Cochabamba';
    const saveInfoChecked = cache.save_info !== false ? 'checked' : '';
    
    // Costo inicial de envío (Express por defecto)
    let shippingCost = 15.00;
    
    const wrapper = document.createElement('div');
    wrapper.className = "max-w-7xl mx-auto px-4 py-8 lg:flex lg:gap-12 animate-fade text-black";
    
    // Estructura de dos columnas
    wrapper.innerHTML = `
    <!-- Columna Izquierda: Formulario (Shopify Checkout) -->
    <div class="lg:w-7/12 space-y-8">
        
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
            <h2 class="text-xs font-black uppercase tracking-wider text-black mb-1 text-left">Entrega</h2>
            
            <!-- País -->
            <div class="flex flex-col gap-1.5 text-left">
                <label class="text-[8px] font-black uppercase tracking-widest text-gray-400">País / Región</label>
                <select id="chk-country" class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs bg-gray-50 font-bold focus:border-black outline-none transition-all">
                    <option value="Bolivia">Bolivia</option>
                </select>
            </div>

            <!-- Nombre y Apellidos -->
            <div class="grid grid-cols-2 gap-3">
                <div class="flex flex-col gap-1">
                    <input type="text" id="chk-first-name" value="${firstNameVal}" placeholder="Nombre (opcional)" 
                           class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black transition-all font-medium">
                </div>
                <div class="flex flex-col gap-1 text-left">
                    <input type="text" id="chk-last-name" value="${lastNameVal}" placeholder="Apellidos" 
                           class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black transition-all font-medium">
                    <p class="text-[9px] text-red-500 font-bold mt-1 hidden" id="err-chk-last-name">Introduce un apellido</p>
                </div>
            </div>

            <!-- Dirección -->
            <div class="relative text-left">
                <input type="text" id="chk-address" value="${addressVal}" placeholder="Dirección (Calle, avenida, Nro. de casa/puerta)" 
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

            <!-- Apartamento/Suite y Ciudad -->
            <div class="grid grid-cols-2 gap-3">
                <input type="text" id="chk-apartment" value="${apartmentVal}" placeholder="Casa, departamento, piso, etc. (opcional)" 
                       class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black transition-all font-medium">
                
                <div class="relative text-left">
                    <input type="text" id="chk-city" value="${cityVal}" placeholder="Ciudad" 
                           class="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs outline-none focus:border-black transition-all font-medium">
                    <p class="text-[9px] text-red-500 font-bold mt-1 hidden" id="err-chk-city">Introduce la ciudad</p>
                </div>
            </div>

            <!-- Guardar Información Checkbox -->
            <label class="flex items-center gap-2 cursor-pointer select-none mt-2 text-left">
                <input type="checkbox" id="chk-save-info" ${saveInfoChecked} class="rounded border-gray-300 text-black focus:ring-black w-4 h-4">
                <span class="text-[10px] text-gray-500 font-bold">Guardar mi información y consultar más rápidamente la próxima vez (en caché local)</span>
            </label>
        </div>

        <!-- Métodos de Envío -->
        <div class="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
            <h2 class="text-xs font-black uppercase tracking-wider text-black text-left">Métodos de envío</h2>
            
            <div class="space-y-3">
                <!-- Envío Delivery / Express -->
                <label class="flex items-center justify-between p-4 border border-black rounded-2xl cursor-pointer hover:border-black transition-all select-none bg-gray-50/10 text-left" id="lbl-ship-express">
                    <div class="flex items-center gap-3">
                        <input type="radio" name="shipping-method" id="ship-express" value="express" checked 
                               class="text-black focus:ring-black w-4 h-4" onchange="window.updateCheckoutShipping(15.00)">
                        <div class="flex flex-col">
                            <span class="text-xs font-black text-black">Envío Delivery Express (A Domicilio)</span>
                            <span class="text-[9px] text-gray-400 font-bold">Entrega directa en la puerta de tu casa</span>
                        </div>
                    </div>
                    <span class="text-xs font-black text-black">BOB 15,00</span>
                </label>

                <!-- Envío Gratis -->
                <label class="flex items-center justify-between p-4 border border-gray-200 rounded-2xl cursor-pointer hover:border-black transition-all select-none text-left" id="lbl-ship-free">
                    <div class="flex items-center gap-3">
                        <input type="radio" name="shipping-method" id="ship-free" value="free" 
                               class="text-black focus:ring-black w-4 h-4" onchange="window.updateCheckoutShipping(0.00)">
                        <div class="flex flex-col">
                            <span class="text-xs font-black text-black">Envío Gratis (Punto de Encuentro / Retiro)</span>
                            <span class="text-[9px] text-gray-400 font-bold">Coordinar entrega en un punto estratégico sin costo de envío</span>
                        </div>
                    </div>
                    <span class="text-xs font-black text-green-600">Gratis</span>
                </label>
            </div>
        </div>

        <!-- Métodos de Pago -->
        <div class="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-3 text-left">
            <h2 class="text-xs font-black uppercase tracking-wider text-black">Pago</h2>
            <p class="text-[10px] text-gray-400 font-bold">Todas las transacciones son seguras y están encriptadas.</p>
            
            <div class="p-4 border border-black bg-gray-50/20 rounded-2xl flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-4 h-4 rounded-full border border-black flex items-center justify-center bg-black">
                        <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
                    </div>
                    <div class="flex flex-col text-left">
                        <span class="text-xs font-black text-black">Pago contra entrega / Contra entrega</span>
                        <span class="text-[9px] text-gray-400 font-bold">Paga en efectivo al recibir tu pedido</span>
                    </div>
                </div>
                <i class="fa-solid fa-money-bill-wave text-gray-600 text-sm"></i>
            </div>
        </div>

        <!-- Dirección de Facturación -->
        <div class="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4 text-left">
            <h2 class="text-xs font-black uppercase tracking-wider text-black">Dirección de facturación</h2>
            
            <div class="space-y-3">
                <label class="flex items-center gap-3 p-4 border border-gray-200 rounded-2xl cursor-pointer hover:border-black transition-all select-none bg-gray-50/10">
                    <input type="radio" name="billing-option" id="bill-same" value="same" checked class="text-black focus:ring-black w-4 h-4">
                    <span class="text-xs font-black text-black">La misma dirección de envío</span>
                </label>
                <label class="flex items-center gap-3 p-4 border border-gray-200 rounded-2xl cursor-pointer hover:border-black transition-all select-none">
                    <input type="radio" name="billing-option" id="bill-different" value="different" class="text-black focus:ring-black w-4 h-4">
                    <span class="text-xs font-black text-black">Usar una dirección de facturación distinta</span>
                </label>
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
    <div class="lg:w-5/12 mt-8 lg:mt-0">
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
                    <span class="text-black font-black text-right" id="checkout-shipping-fee-text">BOB ${shippingCost.toFixed(2)}</span>
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
    window.updateCheckoutShipping = (cost) => {
        shippingCost = cost;
        const total = subtotal + shippingCost;
        
        // Actualizar visualmente los precios en el DOM
        const shipText = document.getElementById('checkout-shipping-fee-text');
        const totalText = document.getElementById('checkout-total-text');
        if (shipText) shipText.innerText = cost === 0 ? "Gratis" : `BOB ${cost.toFixed(2)}`;
        if (totalText) totalText.innerText = `BOB ${total.toFixed(2)}`;
        
        // Estilizar las tarjetas de selección
        const lblExpress = document.getElementById('lbl-ship-express');
        const lblFree = document.getElementById('lbl-ship-free');
        if (cost === 0) {
            lblFree?.classList.add('bg-gray-50/10', 'border-black');
            lblExpress?.classList.remove('bg-gray-50/10', 'border-black');
        } else {
            lblExpress?.classList.add('bg-gray-50/10', 'border-black');
            lblFree?.classList.remove('bg-gray-50/10', 'border-black');
        }
    };

    window.submitCheckoutForm = async () => {
        // Campos
        const email = document.getElementById('chk-email').value.trim();
        const phone = document.getElementById('chk-phone').value.trim();
        const firstName = document.getElementById('chk-first-name').value.trim();
        const lastName = document.getElementById('chk-last-name').value.trim();
        const address = document.getElementById('chk-address').value.trim();
        const mapsLink = document.getElementById('chk-maps-link').value.trim();
        const doorDesc = document.getElementById('chk-door-desc').value.trim();
        const apartment = document.getElementById('chk-apartment').value.trim();
        const city = document.getElementById('chk-city').value.trim();
        const saveInfo = document.getElementById('chk-save-info').checked;
        const isExpress = document.getElementById('ship-express').checked;
        
        // Validación
        let isValid = true;
        
        // Correo
        if (!email || !email.includes('@')) {
            document.getElementById('err-chk-email').classList.remove('hidden');
            document.getElementById('chk-email').classList.add('border-red-500');
            isValid = false;
        } else {
            document.getElementById('err-chk-email').classList.add('hidden');
            document.getElementById('chk-email').classList.remove('border-red-500');
        }

        // Celular
        if (!phone) {
            document.getElementById('err-chk-phone').classList.remove('hidden');
            document.getElementById('chk-phone').classList.add('border-red-500');
            isValid = false;
        } else {
            document.getElementById('err-chk-phone').classList.add('hidden');
            document.getElementById('chk-phone').classList.remove('border-red-500');
        }
        
        // Apellido
        if (!lastName) {
            document.getElementById('err-chk-last-name').classList.remove('hidden');
            document.getElementById('chk-last-name').classList.add('border-red-500');
            isValid = false;
        } else {
            document.getElementById('err-chk-last-name').classList.add('hidden');
            document.getElementById('chk-last-name').classList.remove('border-red-500');
        }
        
        // Dirección
        if (!address) {
            document.getElementById('err-chk-address').classList.remove('hidden');
            document.getElementById('chk-address').classList.add('border-red-500');
            isValid = false;
        } else {
            document.getElementById('err-chk-address').classList.add('hidden');
            document.getElementById('chk-address').classList.remove('border-red-500');
        }
        
        // Ciudad
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
        
        // Guardar información en caché local si el checkbox está activo
        if (saveInfo) {
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
        } else {
            localStorage.removeItem('emma_store_checkout_cache');
        }
        
        // Asignar vendedor aleatorio
        const sc = {}; 
        state.cart.forEach(i => sc[i.contactId] = (sc[i.contactId] || 0) + i.quantity);
        const max = Math.max(...Object.values(sc));
        const wins = Object.keys(sc).filter(sid => sc[sid] === max);
        const seller = state.contacts.find(c => c.id == wins[Math.floor(Math.random() * wins.length)]) || state.contacts[0] || { name: 'Ventas', number: '' };
        
        // Formatear mensaje para WhatsApp
        const shippingFeeText = isExpress ? 15.00 : 0.00;
        const totalCost = subtotal + shippingFeeText;
        
        let m = "✨ *EMMA STORE - NUEVO PEDIDO* ✨\n";
        m += "━━━━━━━━━━━━━━━━━━━━━\n\n";
        
        m += "👤 *CONTACTO Y CLIENTE:*\n";
        m += `   └─ Nombre: ${firstName ? firstName + ' ' : ''}${lastName}\n`;
        m += `   └─ Correo: ${email}\n`;
        m += `   └─ Celular: ${phone}\n\n`;
        
        m += "📍 *ENTREGA Y DIRECCIÓN:*\n";
        m += `   └─ Ciudad/Depto: ${city}\n`;
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
        m += "\n";
        
        m += "🚚 *MÉTODO DE ENVÍO:*\n";
        m += isExpress ? "   └─ Envío Delivery Express (BOB 15.00)\n\n" : "   └─ Envío Gratis (Punto de Encuentro)\n\n";
        
        m += "🛍️ *PRODUCTOS DEL PEDIDO:*\n";
        state.cart.forEach(item => {
            m += `   └─ ${item.name.toUpperCase()} (Cant: ${item.quantity}) | BOB ${(item.price * item.quantity).toFixed(2)}\n`;
        });
        m += "\n";
        
        m += "━━━━━━━━━━━━━━━━━━━━━\n";
        m += `💵 Subtotal: BOB ${subtotal.toFixed(2)}\n`;
        m += `🚚 Envío: BOB ${shippingFeeText.toFixed(2)}\n`;
        m += `💰 *TOTAL A PAGAR: BOB ${totalCost.toFixed(2)}*\n`;
        m += "━━━━━━━━━━━━━━━━━━━━━\n\n";
        m += "💵 *Método de Pago:* Pago contra entrega\n";
        
        // Mostrar spinner/bloqueo de botón opcional aquí (asumiremos rápido para UX local)
        
        // Guardar pedido en Supabase
        const orderNumber = "EMMA-" + Math.random().toString(36).substr(2, 6).toUpperCase();
        
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
                        shipping_method: isExpress ? 'express' : 'free',
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
                        items: state.cart
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
                            shipping_method: isExpress ? 'express' : 'free',
                            shipping_address: address,
                            shipping_city: city,
                            shipping_department: state.selectedDepartment,
                            shipping_maps_link: mapsLink,
                            shipping_door_desc: doorDesc,
                            shipping_apartment: apartment,
                            seller_name: seller.name,
                            seller_number: seller.number?.toString()
                        },
                        items: state.cart.map(item => ({
                            product_id: item.id,
                            product_name: item.name,
                            product_image: item.images ? item.images[0] : item.image,
                            quantity: item.quantity,
                            price: item.price
                        }))
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
            <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="mt-6 text-[10px] font-bold text-gray-400 hover:text-green-500 transition-colors uppercase tracking-widest flex items-center justify-center gap-2">
                <i class="fa-brands fa-whatsapp text-sm"></i> Opcional: Escríbenos por WhatsApp
            </a>
            ` : ''}
        </div>
    </div>`;
}

window.askInfo = (id) => {
    // GANCHO DE AUTENTICACIÓN (permitir visitantes)
    if (!state.user && !state.isGuest) {
        window.openLoginHookModal(() => window.askInfo(id));
        return;
    }

    const p = state.products.find(x => x.id === id);
    const v = state.contacts.find(x => x.id == p.contactId) || state.contacts[0];
    const customerName = state.user ? state.user.name : 'Visitante';
    const msg = p.whatsappCustomMsg || `Hola Emma Store!\n\nInteresada en: ${p.name}\nPrecio: BS ${p.price}\n\n👤 Cliente: ${customerName}\n📍 Departamento: ${state.selectedDepartment}`;
    if (confirm("¿Consultar stock?")) {
        window.location.href = `https://wa.me/${v.number.toString().replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
    }
};

// --- ATAJOS TECLADO ---
document.addEventListener('keydown', (e) => {
    if (e.key === "Escape") { window.closeLightbox(); window.closeStory(); }
    if (e.key === "ArrowRight") { window.nextImg(); if (state.activeStoryIndex !== -1) window.nextStory(); }
    if (e.key === "ArrowLeft") { window.prevImg(); if (state.activeStoryIndex !== -1) window.prevStory(); }
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

window.onload = loadData;
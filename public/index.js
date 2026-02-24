// --- ESTADO GLOBAL ---
const state = {
    view: 'home',
    products: [],
    categories: [],
    contacts: [],
    stories: [],
    cart: [],
    selectedCategory: 'todas',
    selectedProduct: null,
    detailActiveImg: 0,
    detailSlideInterval: null,
    userInteractionTimeout: null,
    // Estado para Historias
    activeStoryIndex: -1,
    storyTimer: null
};

// --- MOTOR DE DATOS ---
async function loadData() {
    try {
        const [p, cat, con, s] = await Promise.all([
            fetch('/api/products').then(r => r.json()),
            fetch('/api/categories').then(r => r.json()),
            fetch('/api/contacts').then(r => r.json()),
            fetch('/api/stories').then(r => r.json())
        ]);
        state.products = p;
        state.categories = cat;
        state.contacts = con;
        state.stories = s;
        render();
        document.getElementById('loading-overlay')?.classList.add('hidden');
    } catch (e) { console.error("Error cargando datos:", e); }
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
    document.getElementById('story-vendor').innerText = vendor ? vendor.name : "Emma Store";
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

// --- NAVEGACIÓN Y RENDER ---
window.navigate = (view, id = null) => {
    state.view = view;
    if (id) {
        state.selectedProduct = state.products.find(p => p.id == id);
        state.detailActiveImg = 0;
        startDetailAutoSlide();
    } else {
        clearInterval(state.detailSlideInterval);
    }
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

function render() {
    const main = document.getElementById('main-view');
    if(!main) return;
    main.innerHTML = '';
    if (state.view === 'home') {
        renderStories(main);
        renderSubmenu(main);
        renderCatalog(main);
    } else if (state.view === 'detail') {
        renderDetail(main);
    }
}

// --- VISTAS ESPECÍFICAS ---
function renderStories(container) {
    const div = document.createElement('div');
    div.className = "max-w-7xl mx-auto px-6 py-6 flex gap-6 overflow-x-auto no-scrollbar animate-fade";
    div.innerHTML = state.stories.map((s, index) => `
        <div class="flex-shrink-0 text-center cursor-pointer" onclick="window.openStory(${index})">
            <div class="w-16 h-16 rounded-full p-[2px] border-2 border-black">
                <img src="${s.imageUrl}" class="w-full h-full object-cover rounded-full">
            </div>
            <p class="text-[7px] font-black uppercase mt-2 opacity-40">Ver</p>
        </div>
    `).join('');
    if (state.stories.length > 0) container.appendChild(div);
}

function renderSubmenu(container) {
    const div = document.createElement('div');
    div.className = "max-w-7xl mx-auto px-6 mb-12 flex gap-4 overflow-x-auto no-scrollbar py-2";
    div.innerHTML = `<button onclick="filterCategory('todas')" class="px-8 py-3 rounded-full text-[10px] font-black uppercase tracking-widest ${state.selectedCategory === 'todas' ? 'bg-black text-white' : 'bg-gray-100 opacity-40'}">Todas</button>` + 
    state.categories.map(c => `<button onclick="filterCategory(${c.id})" class="px-8 py-3 rounded-full text-[10px] font-black uppercase tracking-widest ${state.selectedCategory == c.id ? 'bg-black text-white' : 'bg-gray-100 opacity-40'}">${c.name}</button>`).join('');
    container.appendChild(div);
}

window.filterCategory = (id) => { state.selectedCategory = id; render(); };

function renderCatalog(container) {
    const filtered = state.selectedCategory === 'todas' ? state.products : state.products.filter(p => p.categoryId == state.selectedCategory);
    const grid = document.createElement('div');
    grid.className = "max-w-7xl mx-auto px-6 grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-12 animate-fade";
    grid.innerHTML = filtered.map(p => `
        <div class="product-card group">
            <div class="aspect-[3/4] overflow-hidden bg-gray-50 rounded-[2.5rem] mb-6 relative cursor-pointer" 
                 onmouseenter="startCatalogHoverSlide(this, '${encodeURIComponent(JSON.stringify(p.images))}')" 
                 onmouseleave="stopCatalogHoverSlide(this, '${p.images[0]}')"
                 onclick="navigate('detail', ${p.id})">
                <img src="${p.images[0]}" class="product-image w-full h-full object-cover">
            </div>
            <div class="flex justify-between items-start px-2 mb-4">
                <div><h3 class="text-[10px] font-black uppercase">${p.name}</h3><p class="text-[8px] opacity-40 text-black">BOUTIQUE PRO</p></div>
                <span class="text-xs font-black">BS ${p.price}</span>
            </div>
            <button onclick="addToCart(${p.id})" class="w-full bg-black text-white py-4 rounded-2xl text-[9px] font-black uppercase tracking-widest hover:scale-[1.02] transition-transform shadow-xl">Añadir a la bolsa</button>
        </div>`).join('');
    container.appendChild(grid);
}

function renderDetail(container) {
    const p = state.selectedProduct;
    container.innerHTML = `
    <div class="max-w-7xl mx-auto px-6 py-12 lg:flex gap-16 animate-fade">
        <div class="lg:w-1/2 mb-10 lg:mb-0">
            <div class="relative aspect-square bg-gray-50 rounded-[3.5rem] overflow-hidden shadow-inner cursor-zoom-in group" onclick="openLightbox()">
                <img id="detail-main-img" src="${p.images[state.detailActiveImg]}" class="w-full h-full object-cover transition-all duration-500">
                <div class="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/40 backdrop-blur-md text-white px-4 py-2 rounded-full text-[8px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                    Click para pantalla completa
                </div>
            </div>
            <div class="flex gap-3 mt-6 overflow-x-auto no-scrollbar">
                ${p.images.map((img, i) => `
                    <button onclick="changeDetailImg(${i}, true)" 
                            class="thumb-btn flex-shrink-0 w-20 h-20 rounded-2xl border-2 transition-all overflow-hidden ${i === state.detailActiveImg ? 'border-black' : 'border-transparent opacity-50'}">
                        <img src="${img}" class="w-full h-full object-cover">
                    </button>
                `).join('')}
            </div>
        </div>
        <div class="lg:w-1/2">
            <p class="text-[10px] font-black opacity-30 uppercase tracking-[0.3em] mb-2">Emma Store Bolivia</p>
            <h1 class="text-5xl lg:text-7xl font-black uppercase tracking-tighter mb-4 text-black leading-none">${p.name}</h1>
            <p class="text-3xl font-black mb-6 text-black">BS ${p.price}</p>
            
            <div class="mb-10">
                <h4 class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Descripción</h4>
                <p class="text-sm leading-relaxed text-gray-600 font-medium">${p.description || 'Este producto exclusivo de Emma Store no cuenta con una descripción detallada en este momento.'}</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <button onclick="addToCart(${p.id})" class="bg-black text-white py-7 rounded-3xl text-[10px] font-black uppercase tracking-widest shadow-2xl hover:bg-gray-900 transition-all">Añadir a la bolsa</button>
                <button onclick="askInfo(${p.id})" class="bg-green-500 text-white py-7 rounded-3xl text-[10px] font-black uppercase tracking-widest shadow-2xl flex items-center justify-center gap-3">
                    <i class="fa-brands fa-whatsapp text-xl"></i> Consultar Stock
                </button>
            </div>
            <button onclick="navigate('home')" class="w-full py-6 border-2 border-black rounded-3xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-50 transition-all">Volver al catálogo</button>
        </div>
    </div>`;
}

// --- MOTOR WHATSAPP ---
window.checkout = (e) => {
    if (e) e.preventDefault();
    if (state.cart.length === 0) return alert("Bolsa vacía");
    const sc = {}; 
    state.cart.forEach(i => sc[i.contactId] = (sc[i.contactId] || 0) + i.quantity);
    const max = Math.max(...Object.values(sc));
    const wins = Object.keys(sc).filter(sid => sc[sid] === max);
    const seller = state.contacts.find(c => c.id == wins[Math.floor(Math.random() * wins.length)]) || state.contacts[0];
    let total = 0;
    let m = "✨ *EMMA STORE* ✨\n━━━━━━━━━━━━━━━━━━━━━\n\n";
    state.cart.forEach(i => {
        const subtotal = i.price * i.quantity;
        total += subtotal;
        m += `🛍️ *${i.name.toUpperCase()}*\n   └─ 🔢 Cant: ${i.quantity} | 💵 Sub: BS ${subtotal.toFixed(2)}\n\n`;
    }); 
    m += "━━━━━━━━━━━━━━━━━━━━━\n" + `💰 *TOTAL: BS ${total.toFixed(2)}*\n` + "━━━━━━━━━━━━━━━━━━━━━\n\n";
    if (confirm("¿Enviar pedido a WhatsApp?")) {
        window.location.href = `https://wa.me/${seller.number.toString().replace(/\D/g, '')}?text=${encodeURIComponent(m)}`;
    }
};

window.askInfo = (id) => {
    const p = state.products.find(x => x.id === id);
    const v = state.contacts.find(x => x.id == p.contactId) || state.contacts[0];
    const msg = p.whatsappCustomMsg || `Hola Emma Store!\n\nInteresada en: ${p.name}\nPrecio: BS ${p.price}`;
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

window.onload = loadData;
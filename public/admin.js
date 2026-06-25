// --- ESTADO GLOBAL DEL ADMIN ---
const adminState = {
    view: 'products',
    products: [],
    categories: [],
    contacts: [],
    promotions: [],
    logs: [],
    users: [],
    orders: [],
    tempImages: [],
    isEditing: null,
    isNavOpen: window.innerWidth >= 1024,
    adminEmails: [],
    // Sistema de historial de navegación
    viewHistory: [],
    // Para vistas de detalle
    selectedOrderId: null,
    selectedUserId: null,
    detailTab: 'order', // 'order' | 'profile'
    // Acordeones expandidos
    expandedOrders: new Set(),
    // OTP
    otpPendingEmail: null,
    otpStep: 'email' // 'email' | 'code' | 'sending'
};

// --- PERSISTENCIA Y LOGIN ---
window.onload = () => {
    const savedSession = localStorage.getItem('emma_admin_session');
    if (savedSession) {
        document.getElementById('admin-login').classList.add('hidden');
        document.getElementById('admin-content').classList.remove('hidden');
        
        // Ocultar sidebar en móvil por defecto
        if (window.innerWidth < 1024) {
            adminState.isNavOpen = false;
            document.getElementById('admin-sidebar').classList.add('-translate-x-full');
            document.getElementById('admin-main-container').classList.remove('lg:ml-72');
        }
        
        loadAdminData();
    }
    
    // Manejar navegación atrás del navegador
    window.addEventListener('popstate', (e) => {
        const params = new URLSearchParams(window.location.search);
        if (params.has('view')) {
            adminState.view = params.get('view');
            adminState.selectedOrderId = params.get('orderId') || null;
            adminState.selectedUserId = params.get('userId') || null;
            adminState.detailTab = params.get('tab') || 'order';
            renderAdmin();
        } else if (adminState.viewHistory.length > 0) {
            const prev = adminState.viewHistory.pop();
            adminState.view = prev.view;
            adminState.selectedOrderId = prev.selectedOrderId || null;
            adminState.selectedUserId = prev.selectedUserId || null;
            adminState.detailTab = prev.detailTab || 'order';
            renderAdmin();
        }
    });
};

// Enter key para login
document.getElementById('admin-pass')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkAdminLogin();
});

async function checkAdminLogin() {
    const password = document.getElementById('admin-pass').value.trim();
    const rememberMe = document.getElementById('remember-me').checked;
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            if (rememberMe) localStorage.setItem('emma_admin_session', 'active_session_token');
            document.getElementById('admin-login').classList.add('hidden');
            document.getElementById('admin-content').classList.remove('hidden');
            
            if (window.innerWidth < 1024) {
                adminState.isNavOpen = false;
                document.getElementById('admin-sidebar').classList.add('-translate-x-full');
            }
            
            loadAdminData();
        } else {
            alert("Contraseña incorrecta");
        }
    } catch (err) { alert("Error de conexión"); }
}

// --- CARGA DE DATOS ---
async function loadAdminData() {
    try {
        const [p, c, cat, s, l, u, o, em] = await Promise.all([
            fetch('/api/products').then(r => r.json()),
            fetch('/api/contacts').then(r => r.json()),
            fetch('/api/categories').then(r => r.json()),
            fetch('/api/promotions').then(r => r.json()),
            fetch('/api/logs').then(r => r.json()),
            fetch('/api/admin/users').then(r => r.json()),
            fetch('/api/admin/orders').then(r => r.json()),
            fetch('/api/admin/emails').then(r => r.json())
        ]);
        adminState.products = p;
        adminState.contacts = c;
        adminState.categories = cat;
        adminState.promotions = s;
        adminState.logs = l;
        adminState.users = u || [];
        adminState.orders = o || [];
        adminState.adminEmails = em || [];
        
        // Deep linking check and initial load from URL params
        const params = new URLSearchParams(window.location.search);
        if (params.has('order')) {
            const orderId = params.get('order');
            const targetOrder = adminState.orders.find(o => o.order_number === orderId);
            if (targetOrder) {
                adminState.view = 'order-detail';
                adminState.selectedOrderId = targetOrder.id;
                adminState.detailTab = 'order';
            }
        } else if (params.has('view')) {
            adminState.view = params.get('view');
            adminState.selectedOrderId = params.get('orderId') || null;
            adminState.selectedUserId = params.get('userId') || null;
            adminState.detailTab = params.get('tab') || 'order';
        }
        
        // Restore initial URL cleanly
        const initParams = new URLSearchParams();
        initParams.set('view', adminState.view);
        if (adminState.selectedOrderId) initParams.set('orderId', adminState.selectedOrderId);
        if (adminState.selectedUserId) initParams.set('userId', adminState.selectedUserId);
        if (adminState.detailTab) initParams.set('tab', adminState.detailTab);
        
        window.history.replaceState({ adminView: adminState.view }, '', '/admin.html?' + initParams.toString());
        
        renderAdmin();
        
    } catch (err) { console.error("Error cargando datos:", err); }
}

// --- NAVEGACIÓN CON HISTORIAL ---
function toggleNav() {
    adminState.isNavOpen = !adminState.isNavOpen;
    const sidebar = document.getElementById('admin-sidebar');
    const mainContent = document.getElementById('admin-main-container');
    const toggleBtn = document.getElementById('nav-toggle-btn');

    if (adminState.isNavOpen) {
        sidebar.classList.remove('-translate-x-full');
        if (window.innerWidth >= 1024) mainContent.classList.add('lg:ml-72');
        toggleBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    } else {
        sidebar.classList.add('-translate-x-full');
        mainContent.classList.remove('lg:ml-72');
        toggleBtn.innerHTML = '<i class="fa-solid fa-bars"></i>';
    }
}

function setAdminView(v, extra = {}) {
    // Guardar estado actual en historial
    adminState.viewHistory.push({
        view: adminState.view,
        selectedOrderId: adminState.selectedOrderId,
        selectedUserId: adminState.selectedUserId,
        detailTab: adminState.detailTab
    });
    
    adminState.view = v;
    adminState.isEditing = null;
    adminState.tempImages = [];
    adminState.selectedOrderId = extra.orderId || null;
    adminState.selectedUserId = extra.userId || null;
    adminState.detailTab = extra.tab || 'order';
    
    if (window.innerWidth < 1024 && adminState.isNavOpen) toggleNav();
    
    // Sincronizar URL Params
    const params = new URLSearchParams();
    params.set('view', v);
    if (adminState.selectedOrderId) params.set('orderId', adminState.selectedOrderId);
    if (adminState.selectedUserId) params.set('userId', adminState.selectedUserId);
    if (adminState.detailTab) params.set('tab', adminState.detailTab);
    
    const stateObj = { adminView: v, selectedOrderId: adminState.selectedOrderId, selectedUserId: adminState.selectedUserId, detailTab: adminState.detailTab };
    history.pushState(stateObj, '', '/admin.html?' + params.toString());
    
    renderAdmin();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goBackAdmin() {
    if (adminState.viewHistory.length > 0) {
        const prev = adminState.viewHistory.pop();
        adminState.view = prev.view;
        adminState.selectedOrderId = prev.selectedOrderId;
        adminState.selectedUserId = prev.selectedUserId;
        adminState.detailTab = prev.detailTab;
        renderAdmin();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function renderAdmin() {
    const main = document.getElementById('admin-main');
    
    // Actualizar nav activa
    document.querySelectorAll('.admin-nav-item').forEach(btn => {
        const onclick = btn.getAttribute('onclick') || '';
        let isActive = false;
        if (adminState.view === 'order-detail') isActive = onclick.includes("'orders'");
        else if (adminState.view === 'user-detail') isActive = onclick.includes("'users'");
        else isActive = onclick.includes(`'${adminState.view}'`);
        btn.classList.toggle('active', isActive);
    });

    if (adminState.view === 'products') renderProductsView(main);
    else if (adminState.view === 'categories') renderCategoriesView(main);
    else if (adminState.view === 'promotions') renderPromotionsView(main);
    else if (adminState.view === 'team') renderTeamView(main);
    else if (adminState.view === 'logs') renderLogsView(main);
    else if (adminState.view === 'users') renderUsersView(main);
    else if (adminState.view === 'orders') renderOrdersView(main);
    else if (adminState.view === 'order-detail') renderOrderDetailView(main);
    else if (adminState.view === 'user-detail') renderUserDetailView(main);
    else if (adminState.view === 'settings') renderSettingsView(main);
    else if (adminState.view === 'notifications') renderNotificationsView(main);
    else if (adminState.view === 'delivery') renderDeliveryView(main);
}


// --- GESTIÓN DE IMÁGENES ---
async function handleImageUpload(input, single = false) {
    const files = Array.from(input.files);
    const previewContainer = document.getElementById('preview-container');
    const label = input.nextElementSibling; 
    
    if (single) {
        adminState.tempImages = [];
        if(previewContainer) previewContainer.innerHTML = '';
    }

    if(label) label.innerText = "Procesando archivos...";

    const uploadPromises = files.map(file => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result;
                if (single) adminState.tempImages = [base64];
                else adminState.tempImages.push(base64);

                if (previewContainer) {
                    const div = document.createElement('div');
                    div.className = "relative group animate-fade";
                    div.innerHTML = `
                        <img src="${base64}" class="w-24 h-24 object-cover rounded-2xl shadow-md border-2 border-white">
                        <button type="button" onclick="removeTempImage(this, '${base64}')" class="absolute -top-2 -right-2 bg-red-500 text-white w-6 h-6 rounded-full text-xs shadow-lg flex items-center justify-center">×</button>
                    `;
                    previewContainer.appendChild(div);
                }
                resolve();
            };
            reader.readAsDataURL(file);
        });
    });

    await Promise.all(uploadPromises);
    if(label) label.innerText = "¡Fotos Listas!";
}

function removeTempImage(btn, base64) {
    adminState.tempImages = adminState.tempImages.filter(img => img !== base64);
    btn.parentElement.remove();
}

// --- ENVÍO CON BARRA DE PROGRESO FLOTANTE (NO BLOQUEANTE) ---
window.toggleProgressPanel = () => {
    const content = document.getElementById('progress-panel-content');
    const icon = document.getElementById('progress-panel-icon');
    
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.classList.remove('rotate-180');
    } else {
        content.classList.add('hidden');
        icon.classList.add('rotate-180');
    }
};

window.isUploading = false; // Lock global para prevenir doble subida (Throttling)

function sendWithProgress(url, method, data, callback) {
    if (window.isUploading) {
        showAdminToast("Ya hay una subida en progreso. Por favor, espera a que termine.");
        return;
    }
    
    window.isUploading = true;
    
    const xhr = new XMLHttpRequest();
    const panel = document.getElementById('admin-progress-panel');
    const bar = document.getElementById('progress-panel-bar');
    const text = document.getElementById('progress-panel-text');
    const content = document.getElementById('progress-panel-content');
    const icon = document.getElementById('progress-panel-icon');

    if (panel) {
        // Asegurarse que el panel esté visible y expandido al iniciar
        panel.classList.remove('translate-y-full', 'opacity-0');
        content.classList.remove('hidden');
        icon.classList.remove('rotate-180');
        if (bar) bar.style.width = '0%';
        if (text) text.innerText = 'Iniciando subida...';
    }

    xhr.open(method, url);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            if (bar) bar.style.width = percent + '%';
            if (text) text.innerText = `Subiendo: ${percent}%`;
        }
    };

    xhr.onload = () => {
        if (xhr.status === 200) {
            if (text) text.innerText = "¡Completado!";
            if (bar) bar.style.width = '100%';
            setTimeout(() => {
                if (panel) panel.classList.add('translate-y-full', 'opacity-0');
                window.isUploading = false; // Liberar lock
                callback();
            }, 1500);
        } else {
            if (text) text.innerText = "Error en la subida";
            if (bar) bar.classList.replace('bg-black', 'bg-red-500');
            setTimeout(() => {
                if (panel) panel.classList.add('translate-y-full', 'opacity-0');
                if (bar) bar.classList.replace('bg-red-500', 'bg-black');
                window.isUploading = false; // Liberar lock
            }, 3000);
        }
    };
    
    xhr.onerror = () => {
        if (text) text.innerText = "Error de conexión";
        if (bar) bar.classList.replace('bg-black', 'bg-red-500');
        setTimeout(() => {
            if (panel) panel.classList.add('translate-y-full', 'opacity-0');
            if (bar) bar.classList.replace('bg-red-500', 'bg-black');
            window.isUploading = false; // Liberar lock
        }, 3000);
    };

    xhr.send(JSON.stringify(data));
}

// --- LÓGICA AUTO-MENSAJE WHATSAPP ---
window.generateAutoMsg = () => {
    const name = document.getElementById('prod-name')?.value.trim() || "[NOMBRE]";
    const price = document.getElementById('prod-price')?.value.trim() || "[PRECIO]";
    const msgInput = document.getElementById('whatsapp-msg-input');
    
    if(msgInput) {
        msgInput.value = `Hola Emma Store! Estoy Interesad@ en: ${name} Precio: BS ${price}`;
    }
};

// --- HELPERS ---
function formatDate(dateStr) {
    return new Date(dateStr).toLocaleString('es-BO', { timeZone: 'America/La_Paz' });
}

function getDateLabel(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
    
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (d.getTime() === today.getTime()) return 'Hoy';
    if (d.getTime() === yesterday.getTime()) return 'Ayer';
    if (d >= weekAgo) return 'Esta Semana';
    
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

const statusColors = {
    'confirmado': 'bg-blue-100 text-blue-700',
    'en_proceso': 'bg-amber-100 text-amber-700',
    'enviado': 'bg-purple-100 text-purple-700',
    'entregado': 'bg-emerald-100 text-emerald-700',
    'cancelado': 'bg-red-100 text-red-700'
};

const statusLabels = {
    'confirmado': 'Confirmado',
    'en_proceso': 'En Proceso',
    'enviado': 'Enviado',
    'entregado': 'Entregado',
    'cancelado': 'Cancelado'
};

function showAdminToast(msg) {
    const toast = document.getElementById('admin-toast');
    if (toast) {
        toast.innerHTML = `<div class="bg-black text-white px-8 py-4 rounded-2xl shadow-2xl font-black text-[10px] uppercase tracking-widest">${msg}</div>`;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }
}

// --- HEADER BACK BUTTON (reusable) ---
function renderBackHeader(title, subtitle = '') {
    return `
        <div class="flex items-center gap-4 mb-8 md:mb-12 animate-fade">
            <button onclick="goBackAdmin()" class="w-10 h-10 md:w-12 md:h-12 bg-white border border-gray-200 rounded-2xl flex items-center justify-center hover:bg-black hover:text-white hover:border-black transition-all active:scale-90 flex-shrink-0 shadow-sm cursor-pointer">
                <i class="fa-solid fa-arrow-left text-sm"></i>
            </button>
            <div>
                <h2 class="text-2xl md:text-4xl font-black uppercase tracking-tighter leading-none">${title}</h2>
                ${subtitle ? `<p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">${subtitle}</p>` : ''}
            </div>
        </div>
    `;
}

// =============================================
// VISTAS: PRODUCTOS
// =============================================
function renderProductsView(container) {
    container.innerHTML = `
        <div class="flex justify-between items-center mb-8 md:mb-12 animate-fade">
            <h2 class="text-2xl md:text-4xl font-black uppercase tracking-tighter">Artículos</h2>
            <button onclick="showProductForm()" class="bg-black text-white px-6 md:px-8 py-3 md:py-4 rounded-full text-[10px] font-black uppercase shadow-xl hover:scale-[1.02] active:scale-95 transition-all cursor-pointer">+ Nuevo</button>
        </div>
        <div class="grid grid-cols-1 gap-3 md:gap-4">
            ${adminState.products.map(p => `
                <div class="bg-white p-4 md:p-6 rounded-2xl md:rounded-[2.5rem] flex items-center gap-4 md:gap-8 shadow-sm">
                    <img src="${p.images[0]}" class="w-12 h-12 md:w-16 md:h-16 object-cover rounded-xl md:rounded-2xl flex-shrink-0">
                    <div class="flex-1 min-w-0">
                        <p class="text-[11px] font-black uppercase truncate">${p.name}</p>
                        <p class="text-[9px] opacity-40 font-bold">BS ${p.price}</p>
                    </div>
                    <div class="flex gap-2 flex-shrink-0">
                        <button onclick="showProductForm(${p.id})" class="w-9 h-9 md:w-10 md:h-10 rounded-full bg-gray-50 flex items-center justify-center hover:bg-black hover:text-white transition-all cursor-pointer"><i class="fa-solid fa-edit text-xs"></i></button>
                        <button onclick="deleteAction('products', ${p.id}, '${p.name.replace(/'/g, "\\'")}')" class="w-9 h-9 md:w-10 md:h-10 rounded-full bg-gray-50 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all cursor-pointer"><i class="fa-solid fa-trash text-xs"></i></button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function showProductForm(prodId = null) {
    const p = prodId ? adminState.products.find(x => x.id == prodId) : { name: '', price: '', description: '', categoryId: '', contactId: '', whatsappCustomMsg: '' };
    adminState.isEditing = prodId;
    adminState.tempImages = prodId ? p.images : [];

    document.getElementById('admin-main').innerHTML = `
        <div class="max-w-2xl mx-auto bg-white p-6 md:p-12 rounded-[2rem] md:rounded-[3.5rem] shadow-2xl relative overflow-hidden">
            <div id="upload-progress-overlay" class="hidden absolute inset-0 bg-white/95 z-50 flex flex-col items-center justify-center">
                <div class="w-64 h-2 bg-gray-100 rounded-full overflow-hidden mb-4"><div id="upload-progress-bar" class="h-full bg-black w-0 transition-all"></div></div>
                <p id="upload-progress-text" class="text-[10px] font-black uppercase">Iniciando...</p>
            </div>
            <button onclick="goBackAdmin()" class="mb-6 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-gray-400 hover:text-black transition-colors cursor-pointer bg-transparent border-none">
                <i class="fa-solid fa-arrow-left"></i> Volver
            </button>
            <h2 class="text-xl md:text-2xl font-black mb-8 md:mb-10 uppercase tracking-tighter">${prodId ? 'Editar' : 'Nuevo'} Artículo</h2>
            <form onsubmit="handleProductSubmit(event)" class="space-y-4">
                <input id="prod-name" name="name" value="${p.name}" oninput="generateAutoMsg()" placeholder="Nombre" required class="w-full p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase">
                <input id="prod-price" name="price" type="number" step="0.01" value="${p.price}" oninput="generateAutoMsg()" placeholder="Precio BS" required class="w-full p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase">
                <select name="categoryId" required class="w-full p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase">
                    <option value="">Categoría...</option>
                    ${adminState.categories.map(c => `<option value="${c.id}" ${p.categoryId == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                </select>
                <select name="contactId" required class="w-full p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase">
                    <option value="">Vendedor...</option>
                    ${adminState.contacts.map(v => `<option value="${v.id}" ${p.contactId == v.id ? 'selected' : ''}>${v.name}</option>`).join('')}
                </select>
                <textarea name="description" placeholder="Descripción" class="w-full p-4 md:p-5 bg-gray-50 rounded-2xl h-32 outline-none text-[10px] font-bold uppercase">${p.description}</textarea>
                
                <div class="bg-green-50 p-4 md:p-6 rounded-2xl border-2 border-dashed border-green-100">
                    <p class="text-[9px] font-black uppercase mb-3 text-green-600 italic">Vista previa mensaje WhatsApp:</p>
                    <textarea id="whatsapp-msg-input" name="whatsappCustomMsg" class="w-full p-4 bg-white rounded-xl h-24 outline-none text-[10px] font-bold uppercase shadow-inner border-none">${p.whatsappCustomMsg || ''}</textarea>
                </div>

                <div id="preview-container" class="flex flex-wrap gap-4 mb-4">${adminState.tempImages.map(img => `
                    <div class="relative group">
                        <img src="${img}" class="w-20 h-20 md:w-24 md:h-24 object-cover rounded-2xl shadow-md border-2 border-white">
                        <button type="button" onclick="removeTempImage(this, '${img}')" class="absolute -top-2 -right-2 bg-red-500 text-white w-5 h-6 rounded-full text-xs flex items-center justify-center">×</button>
                    </div>`).join('')}
                </div>
                <input type="file" multiple onchange="handleImageUpload(this)" id="file-p" class="hidden">
                <label for="file-p" class="block p-8 md:p-10 border-4 border-dashed rounded-[2rem] md:rounded-[2.5rem] text-center cursor-pointer text-[10px] font-black uppercase opacity-40 hover:opacity-100 transition-all">Subir Imágenes</label>
                <div class="flex gap-3 md:gap-4 pt-4 md:pt-6">
                    <button type="button" onclick="goBackAdmin()" class="flex-1 py-4 md:py-5 border-2 border-black rounded-2xl font-black text-[10px] uppercase cursor-pointer bg-white">Cancelar</button>
                    <button type="submit" class="flex-1 py-4 md:py-5 bg-black text-white rounded-2xl font-black text-[10px] uppercase shadow-xl cursor-pointer">Guardar</button>
                </div>
            </form>
        </div>
    `;
    if(!prodId) generateAutoMsg();
}

async function handleProductSubmit(e) {
    e.preventDefault();
    if (adminState.tempImages.length === 0) return alert("Selecciona al menos una imagen.");
    const data = Object.fromEntries(new FormData(e.target));
    data.images = adminState.tempImages;
    const url = adminState.isEditing ? `/api/products/${adminState.isEditing}` : '/api/products';
    sendWithProgress(url, adminState.isEditing ? 'PUT' : 'POST', data, () => { loadAdminData(); setAdminView('products'); });
}

// =============================================
// VISTAS: PROMOCIONES
// =============================================
function formatCountdown(endsAt) {
    const diff = endsAt - Date.now();
    if (diff <= 0) return "Vencido";
    
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
    
    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(' ');
}

function renderPromotionsView(container) {
    container.innerHTML = `
        <div class="flex justify-between items-center mb-8 md:mb-12 animate-fade">
            <h2 class="text-2xl md:text-4xl font-black uppercase tracking-tighter">Promociones</h2>
            <button onclick="showPromotionForm()" class="bg-black text-white px-6 md:px-8 py-3 md:py-4 rounded-full text-[10px] font-black uppercase shadow-xl hover:scale-[1.02] active:scale-95 transition-all cursor-pointer">+ Nueva</button>
        </div>
        <div class="grid grid-cols-1 gap-3 md:gap-4">
            ${(adminState.promotions || []).map(p => {
                const isExpired = p.endsAt <= Date.now();
                const expiryLabel = isExpired 
                    ? `<span class="text-red-500 font-bold">Vencida</span>` 
                    : `<span class="text-green-500 font-bold">Vence en: ${formatCountdown(p.endsAt)}</span>`;
                return `
                <div class="bg-white p-4 md:p-6 rounded-2xl md:rounded-[2.5rem] flex items-center gap-4 md:gap-8 shadow-sm">
                    <img src="${p.images && p.images[0] ? p.images[0] : ''}" class="w-12 h-12 md:w-16 md:h-16 object-cover rounded-xl md:rounded-2xl flex-shrink-0">
                    <div class="flex-1 min-w-0 text-left">
                        <p class="text-[11px] font-black uppercase truncate">${p.name}</p>
                        <p class="text-[9px] opacity-40 font-bold mb-1">BS ${p.price}</p>
                        <p class="text-[9px] font-bold uppercase tracking-wider">${expiryLabel}</p>
                    </div>
                    <div class="flex gap-2 flex-shrink-0">
                        <button onclick="showPromotionForm(${p.id})" class="w-9 h-9 md:w-10 md:h-10 rounded-full bg-gray-50 flex items-center justify-center hover:bg-black hover:text-white transition-all cursor-pointer"><i class="fa-solid fa-edit text-xs"></i></button>
                        <button onclick="deleteAction('promotions', ${p.id}, '${p.name.replace(/'/g, "\\'")}')" class="w-9 h-9 md:w-10 md:h-10 rounded-full bg-gray-50 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all cursor-pointer"><i class="fa-solid fa-trash text-xs"></i></button>
                    </div>
                </div>
                `;
            }).join('')}
        </div>
    `;
}

function showPromotionForm(promoId = null) {
    const p = promoId 
        ? adminState.promotions.find(x => x.id == promoId) 
        : { name: '', price: '', description: '', categoryId: '', contactId: '', whatsappCustomMsg: '', duration_type: 'hours', duration_val: '' };
    
    adminState.isEditing = promoId;
    adminState.tempImages = promoId ? p.images : [];

    document.getElementById('admin-main').innerHTML = `
        <div class="max-w-2xl mx-auto bg-white p-6 md:p-12 rounded-[2rem] md:rounded-[3.5rem] shadow-2xl relative overflow-hidden text-left">
            <div id="upload-progress-overlay" class="hidden absolute inset-0 bg-white/95 z-50 flex flex-col items-center justify-center">
                <div class="w-64 h-2 bg-gray-100 rounded-full overflow-hidden mb-4"><div id="upload-progress-bar" class="h-full bg-black w-0 transition-all"></div></div>
                <p id="upload-progress-text" class="text-[10px] font-black uppercase">Iniciando...</p>
            </div>
            <button onclick="goBackAdmin()" class="mb-6 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-gray-400 hover:text-black transition-colors cursor-pointer bg-transparent border-none">
                <i class="fa-solid fa-arrow-left"></i> Volver
            </button>
            <h2 class="text-xl md:text-2xl font-black mb-8 md:mb-10 uppercase tracking-tighter">${promoId ? 'Editar' : 'Nueva'} Promoción</h2>
            <form onsubmit="handlePromotionSubmit(event)" class="space-y-4">
                <input id="promo-name" name="name" value="${p.name}" oninput="generatePromoAutoMsg()" placeholder="Nombre" required class="w-full p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase">
                <input id="promo-price" name="price" type="number" step="0.01" value="${p.price}" oninput="generatePromoAutoMsg()" placeholder="Precio BS" required class="w-full p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase">
                <select name="categoryId" required class="w-full p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase">
                    <option value="">Categoría...</option>
                    ${adminState.categories.map(c => `<option value="${c.id}" ${p.categoryId == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                </select>
                <select name="contactId" required class="w-full p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase">
                    <option value="">Vendedor...</option>
                    ${adminState.contacts.map(v => `<option value="${v.id}" ${p.contactId == v.id ? 'selected' : ''}>${v.name}</option>`).join('')}
                </select>
                <textarea name="description" placeholder="Descripción" class="w-full p-4 md:p-5 bg-gray-50 rounded-2xl h-32 outline-none text-[10px] font-bold uppercase">${p.description}</textarea>
                
                <div class="bg-gray-50 p-6 rounded-[2rem] border border-gray-150 space-y-4">
                    <h4 class="text-[10px] font-black uppercase tracking-widest text-gray-400">Duración de la Promoción</h4>
                    <select id="promo-duration-type" name="durationType" onchange="togglePromoDurationInput()" class="w-full p-4 bg-white rounded-xl border border-gray-200 outline-none text-[10px] font-bold uppercase">
                        <option value="hours" ${p.duration_type === 'hours' ? 'selected' : ''}>Desactivar en X horas</option>
                        <option value="datetime" ${p.duration_type === 'datetime' ? 'selected' : ''}>Fecha y hora límite</option>
                    </select>
                    
                    <div id="promo-duration-val-hours-container" class="${p.duration_type === 'hours' ? '' : 'hidden'}">
                        <input id="promo-duration-val-hours" type="number" step="0.5" value="${p.duration_type === 'hours' ? p.duration_val : ''}" placeholder="Cantidad de horas (ej: 5)" class="w-full p-4 bg-white rounded-xl border border-gray-200 outline-none text-[10px] font-bold uppercase">
                    </div>
                    
                    <div id="promo-duration-val-datetime-container" class="${p.duration_type === 'datetime' ? '' : 'hidden'}">
                        <input id="promo-duration-val-datetime" type="datetime-local" value="${p.duration_type === 'datetime' ? p.duration_val : ''}" class="w-full p-4 bg-white rounded-xl border border-gray-200 outline-none text-[10px] font-bold uppercase">
                    </div>
                </div>

                <div class="bg-green-50 p-4 md:p-6 rounded-2xl border-2 border-dashed border-green-100">
                    <p class="text-[9px] font-black uppercase mb-3 text-green-600 italic">Vista previa mensaje WhatsApp:</p>
                    <textarea id="whatsapp-promo-msg-input" name="whatsappCustomMsg" class="w-full p-4 bg-white rounded-xl h-24 outline-none text-[10px] font-bold uppercase shadow-inner border-none">${p.whatsappCustomMsg || ''}</textarea>
                </div>

                <div id="preview-container" class="flex flex-wrap gap-4 mb-4">${adminState.tempImages.map(img => `
                    <div class="relative group">
                        <img src="${img}" class="w-20 h-20 md:w-24 md:h-24 object-cover rounded-2xl shadow-md border-2 border-white">
                        <button type="button" onclick="removeTempImage(this, '${img}')" class="absolute -top-2 -right-2 bg-red-500 text-white w-5 h-6 rounded-full text-xs flex items-center justify-center">×</button>
                    </div>`).join('')}
                </div>
                <input type="file" multiple onchange="handleImageUpload(this)" id="file-promo" class="hidden">
                <label for="file-promo" class="block p-8 md:p-10 border-4 border-dashed rounded-[2rem] md:rounded-[2.5rem] text-center cursor-pointer text-[10px] font-black uppercase opacity-40 hover:opacity-100 transition-all">Subir Imágenes</label>
                <div class="flex gap-3 md:gap-4 pt-4 md:pt-6">
                    <button type="button" onclick="goBackAdmin()" class="flex-1 py-4 md:py-5 border-2 border-black rounded-2xl font-black text-[10px] uppercase cursor-pointer bg-white">Cancelar</button>
                    <button type="submit" class="flex-1 py-4 md:py-5 bg-black text-white rounded-2xl font-black text-[10px] uppercase shadow-xl cursor-pointer">Guardar</button>
                </div>
            </form>
        </div>
    `;
    if(!promoId) generatePromoAutoMsg();
}

window.togglePromoDurationInput = () => {
    const type = document.getElementById('promo-duration-type').value;
    const hoursContainer = document.getElementById('promo-duration-val-hours-container');
    const datetimeContainer = document.getElementById('promo-duration-val-datetime-container');
    if (type === 'hours') {
        hoursContainer.classList.remove('hidden');
        datetimeContainer.classList.add('hidden');
    } else {
        hoursContainer.classList.add('hidden');
        datetimeContainer.classList.remove('hidden');
    }
};

window.generatePromoAutoMsg = () => {
    const name = document.getElementById('promo-name')?.value.trim() || "[NOMBRE]";
    const price = document.getElementById('promo-price')?.value.trim() || "[PRECIO]";
    const msgInput = document.getElementById('whatsapp-promo-msg-input');
    if(msgInput) {
        msgInput.value = `¡Hola Emma Store! Estoy interesad@ en la promoción: ${name} con precio de: BS ${price}`;
    }
};

async function handlePromotionSubmit(e) {
    e.preventDefault();
    if (adminState.tempImages.length === 0) return alert("Selecciona al menos una imagen.");
    
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);
    
    const type = data.durationType;
    let val = '';
    let endsAt = 0;
    
    if (type === 'hours') {
        val = document.getElementById('promo-duration-val-hours').value;
        if (!val || isNaN(parseFloat(val)) || parseFloat(val) <= 0) {
            return alert("Por favor ingresa una cantidad válida de horas.");
        }
        endsAt = Date.now() + parseFloat(val) * 60 * 60 * 1000;
    } else {
        val = document.getElementById('promo-duration-val-datetime').value;
        if (!val) {
            return alert("Por favor selecciona una fecha y hora límite.");
        }
        endsAt = new Date(val).getTime();
        if (endsAt <= Date.now()) {
            return alert("La fecha y hora límite deben ser en el futuro.");
        }
    }
    
    data.durationVal = val;
    data.endsAt = endsAt;
    data.images = adminState.tempImages;
    
    const url = adminState.isEditing ? `/api/promotions/${adminState.isEditing}` : '/api/promotions';
    sendWithProgress(url, adminState.isEditing ? 'PUT' : 'POST', data, () => { 
        loadAdminData(); 
        setAdminView('promotions'); 
    });
}

// =============================================
// RENDERS: CATEGORÍAS, EQUIPO, LOGS, SETTINGS
// =============================================
// --- ESTADO LOCAL DEL MODULO CATEGORÍAS ---
adminState.catSearchQuery = '';
adminState.catFilterMode = 'all'; // 'all', 'assigned', 'unassigned'
adminState.catPendingAssign = new Set(); // Ids of products marked for the current category

function renderCategoriesView(container) {
    if (!adminState.selectedCategoryId || adminState.detailTab !== 'cat-assign') {
        container.innerHTML = `
            <h2 class="text-2xl md:text-4xl font-black uppercase tracking-tighter mb-8 md:mb-12">Categorías</h2>
            <form onsubmit="handleCategorySubmit(event)" class="bg-white p-4 md:p-8 rounded-[2rem] md:rounded-[2.5rem] mb-6 md:mb-8 flex flex-col sm:flex-row gap-3 md:gap-4 shadow-sm">
                <input name="name" placeholder="Nueva Categoría" required class="flex-1 p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase">
                <button type="submit" class="bg-black text-white px-8 md:px-10 py-3 md:py-0 rounded-2xl font-black text-[10px] uppercase cursor-pointer">Agregar</button>
            </form>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
                ${adminState.categories.map(c => {
                    const assignedCount = adminState.products.filter(p => p.categoryId === c.id).length;
                    return `
                    <div onclick="openCatAssign(${c.id})" class="bg-white p-5 md:p-6 rounded-2xl md:rounded-[2rem] flex items-center gap-4 shadow-sm cursor-pointer hover:shadow-md transition-all group border border-transparent hover:border-gray-200">
                        <div class="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                            <i class="fa-solid fa-tags text-gray-400"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-[11px] font-black uppercase truncate">${c.name}</p>
                            <p class="text-[9px] font-bold text-gray-400 mt-1">${assignedCount} producto(s) asignado(s)</p>
                        </div>
                        <button onclick="event.stopPropagation(); deleteAction('categories', ${c.id}, '${c.name.replace(/'/g, "\\'")}')" class="w-10 h-10 rounded-full hover:bg-red-50 hover:text-red-500 text-gray-300 transition-colors flex items-center justify-center flex-shrink-0 bg-transparent border-none cursor-pointer">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </div>`;
                }).join('')}
            </div>
        `;
    } else {
        renderCatAssignView(container);
    }
}

window.openCatAssign = (categoryId) => {
    adminState.catSearchQuery = '';
    adminState.catFilterMode = 'all';
    adminState.catPendingAssign = new Set(
        adminState.products.filter(p => p.categoryId === categoryId).map(p => p.id)
    );
    adminState.selectedCategoryId = categoryId;
    setAdminView('categories', { tab: 'cat-assign' });
};

function renderCatAssignView(container) {
    const category = adminState.categories.find(c => c.id == adminState.selectedCategoryId);
    if (!category) { goBackAdmin(); return; }

    container.innerHTML = `
        ${renderBackHeader(`Asignar a ${category.name}`, 'Gestión de Productos')}
        
        <div class="bg-white rounded-[2rem] md:rounded-[3rem] p-5 md:p-8 shadow-sm">
            <!-- Barra de Herramientas -->
            <div class="flex flex-col lg:flex-row gap-4 mb-6 md:mb-8 items-start lg:items-center justify-between">
                <div class="flex flex-col sm:flex-row gap-3 w-full lg:w-auto flex-1">
                    <div class="relative flex-1 max-w-md">
                        <i class="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                        <input type="text" placeholder="Buscar productos..." value="${adminState.catSearchQuery}"
                               onkeyup="updateCatSearch(this.value)"
                               class="w-full pl-10 pr-4 py-4 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase border-2 border-transparent focus:border-black transition-all">
                    </div>
                    <select onchange="updateCatFilter(this.value)" class="p-4 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase cursor-pointer border-2 border-transparent focus:border-black">
                        <option value="all" ${adminState.catFilterMode === 'all' ? 'selected' : ''}>Todos los productos</option>
                        <option value="assigned" ${adminState.catFilterMode === 'assigned' ? 'selected' : ''}>Solo Asignados</option>
                        <option value="unassigned" ${adminState.catFilterMode === 'unassigned' ? 'selected' : ''}>No Asignados</option>
                    </select>
                </div>
                
                <div class="flex items-center gap-3 w-full lg:w-auto">
                    <button onclick="toggleAllCatProducts()" class="px-5 py-4 bg-gray-100 hover:bg-gray-200 rounded-2xl text-[9px] font-black uppercase tracking-wider transition-colors border-none cursor-pointer">
                        Seleccionar Visibles
                    </button>
                    <button onclick="saveCatAssignments()" class="flex-1 lg:flex-none px-8 py-4 bg-black text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-gray-900 active:scale-95 transition-all cursor-pointer border-none">
                        Guardar Cambios
                    </button>
                </div>
            </div>

            <!-- Resumen numérico -->
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">
                Total marcados: <span id="cat-marked-count" class="text-black font-black">${adminState.catPendingAssign.size}</span>
            </p>

            <!-- Grid de Productos aislado -->
            <div id="cat-products-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                <!-- Se llenará vía renderCatGrid() -->
            </div>
        </div>
    `;
    renderCatGrid();
}

function renderCatGrid() {
    const grid = document.getElementById('cat-products-grid');
    if (!grid) return;
    const countEl = document.getElementById('cat-marked-count');
    if (countEl) countEl.innerText = adminState.catPendingAssign.size;
    
    const category = adminState.categories.find(c => c.id == adminState.selectedCategoryId);

    let filtered = adminState.products.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(adminState.catSearchQuery.toLowerCase());
        const isAssignedToThis = adminState.catPendingAssign.has(p.id);
        
        if (adminState.catFilterMode === 'assigned') return matchesSearch && isAssignedToThis;
        if (adminState.catFilterMode === 'unassigned') return matchesSearch && !isAssignedToThis;
        return matchesSearch;
    });
    
    // Guardar para toggleAll
    adminState.catCurrentVisible = filtered.map(p => p.id);

    grid.innerHTML = filtered.map(p => {
        const isChecked = adminState.catPendingAssign.has(p.id);
        return `
            <div onclick="toggleCatProduct(${p.id})" class="relative flex items-center p-3 rounded-2xl border-2 cursor-pointer transition-all ${isChecked ? 'border-black bg-gray-50' : 'border-gray-100 hover:border-gray-200'}">
                <div class="w-5 h-5 rounded flex items-center justify-center mr-3 flex-shrink-0 transition-colors ${isChecked ? 'bg-black text-white' : 'bg-gray-200 text-transparent'}">
                    <i class="fa-solid fa-check text-[10px]"></i>
                </div>
                <img src="${p.images[0]}" class="w-10 h-10 rounded-xl object-cover flex-shrink-0">
                <div class="ml-3 min-w-0 flex-1">
                    <p class="text-[10px] font-black uppercase truncate leading-tight">${p.name}</p>
                    <p class="text-[9px] font-bold text-gray-400 mt-0.5 truncate">
                        ${p.categoryId && p.categoryId != category.id && !isChecked ? `<span class="text-amber-500"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Otra categoría</span>` : 'Disponible'}
                    </p>
                </div>
            </div>
        `;
    }).join('') + (filtered.length === 0 ? '<div class="col-span-full py-12 text-center text-gray-400 text-xs font-bold uppercase tracking-widest">No hay resultados</div>' : '');
}

window.updateCatSearch = (val) => {
    adminState.catSearchQuery = val;
    renderCatGrid(); // Actualiza solo la tabla, no pierde el foco
};

window.updateCatFilter = (val) => {
    adminState.catFilterMode = val;
    renderCatGrid();
};

window.toggleCatProduct = (id) => {
    if (adminState.catPendingAssign.has(id)) adminState.catPendingAssign.delete(id);
    else adminState.catPendingAssign.add(id);
    renderCatGrid();
};

window.toggleAllCatProducts = () => {
    const ids = adminState.catCurrentVisible || [];
    if (ids.length === 0) return;
    const allSelected = ids.every(id => adminState.catPendingAssign.has(id));
    if (allSelected) {
        ids.forEach(id => adminState.catPendingAssign.delete(id));
    } else {
        ids.forEach(id => adminState.catPendingAssign.add(id));
    }
    renderCatGrid();
};

window.saveCatAssignments = async () => {
    const categoryId = adminState.selectedCategoryId;
    const productIds = Array.from(adminState.catPendingAssign);
    
    const toast = document.getElementById('admin-toast');
    if(toast) {
        toast.innerHTML = `<div class="bg-black text-white px-8 py-4 rounded-2xl shadow-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2"><i class="fa-solid fa-circle-notch animate-spin"></i> Guardando...</div>`;
        toast.classList.remove('hidden');
    }

    try {
        const res = await fetch(`/api/admin/categories/${categoryId}/assign-products`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productIds })
        });
        
        if (res.ok) {
            adminState.products.forEach(p => {
                if (p.categoryId == categoryId) p.categoryId = null;
                if (adminState.catPendingAssign.has(p.id)) p.categoryId = categoryId;
            });
            showAdminToast('¡Categorías guardadas!');
            setTimeout(() => goBackAdmin(), 1000);
        } else {
            showAdminToast('Error al guardar');
        }
    } catch (err) {
        showAdminToast('Error de conexión');
    }
};

async function handleCategorySubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    loadAdminData();
}

// --- ESTADO LOCAL DEL MODULO EQUIPO ---
adminState.teamSearchQuery = '';
adminState.teamFilterMode = 'all'; // 'all', 'assigned', 'unassigned'
adminState.teamPendingAssign = new Set(); // Ids of products marked for the current contact

function renderTeamView(container) {
    if (!adminState.selectedUserId || adminState.detailTab !== 'team-assign') {
        // Vista Principal (Lista de Equipo)
        container.innerHTML = `
            <h2 class="text-2xl md:text-4xl font-black uppercase tracking-tighter mb-8 md:mb-12">Equipo</h2>
            <form onsubmit="handleTeamSubmit(event)" class="bg-white p-4 md:p-8 rounded-[2rem] md:rounded-[2.5rem] mb-6 md:mb-8 flex flex-col sm:flex-row gap-3 md:gap-4 shadow-sm">
                <input name="name" placeholder="Nombre" required class="flex-1 p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase">
                <input name="number" placeholder="591..." required class="flex-1 p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase">
                <button type="submit" class="bg-black text-white px-8 md:px-10 py-3 md:py-0 rounded-2xl font-black text-[10px] uppercase cursor-pointer">Agregar</button>
            </form>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
                ${adminState.contacts.map(v => {
                    const assignedCount = adminState.products.filter(p => p.contactId === v.id).length;
                    return `
                    <div onclick="openTeamAssign(${v.id})" class="bg-white p-5 md:p-6 rounded-2xl md:rounded-[2rem] flex items-center gap-4 shadow-sm cursor-pointer hover:shadow-md transition-all group border border-transparent hover:border-gray-200">
                        <div class="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                            <i class="fa-solid fa-user-tie text-gray-400"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-[11px] font-black uppercase truncate">${v.name}</p>
                            <p class="text-[9px] font-bold text-gray-400 mt-1">${assignedCount} producto(s) asignado(s)</p>
                        </div>
                        <button onclick="event.stopPropagation(); deleteAction('contacts', ${v.id}, '${v.name.replace(/'/g, "\\'")}')" class="w-10 h-10 rounded-full hover:bg-red-50 hover:text-red-500 text-gray-300 transition-colors flex items-center justify-center flex-shrink-0 bg-transparent border-none">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </div>`;
                }).join('')}
            </div>
        `;
    } else {
        // Vista de Asignación (Master-Detail)
        renderTeamAssignView(container);
    }
}

window.openTeamAssign = (contactId) => {
    adminState.teamSearchQuery = '';
    adminState.teamFilterMode = 'all';
    adminState.teamPendingAssign = new Set(
        adminState.products.filter(p => p.contactId === contactId).map(p => p.id)
    );
    setAdminView('team', { userId: contactId, tab: 'team-assign' });
};

function renderTeamAssignView(container) {
    const contact = adminState.contacts.find(c => c.id == adminState.selectedUserId);
    if (!contact) { goBackAdmin(); return; }

    container.innerHTML = `
        ${renderBackHeader(`Asignar a ${contact.name.split(' ')[0]}`, 'Gestión de Productos')}
        
        <div class="bg-white rounded-[2rem] md:rounded-[3rem] p-5 md:p-8 shadow-sm">
            <!-- Barra de Herramientas -->
            <div class="flex flex-col lg:flex-row gap-4 mb-6 md:mb-8 items-start lg:items-center justify-between">
                <div class="flex flex-col sm:flex-row gap-3 w-full lg:w-auto flex-1">
                    <div class="relative flex-1 max-w-md">
                        <i class="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                        <input type="text" placeholder="Buscar productos..." value="${adminState.teamSearchQuery}"
                               onkeyup="updateTeamSearch(this.value)"
                               class="w-full pl-10 pr-4 py-4 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase border-2 border-transparent focus:border-black transition-all">
                    </div>
                    <select onchange="updateTeamFilter(this.value)" class="p-4 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase cursor-pointer border-2 border-transparent focus:border-black">
                        <option value="all" ${adminState.teamFilterMode === 'all' ? 'selected' : ''}>Todos los productos</option>
                        <option value="assigned" ${adminState.teamFilterMode === 'assigned' ? 'selected' : ''}>Solo Asignados</option>
                        <option value="unassigned" ${adminState.teamFilterMode === 'unassigned' ? 'selected' : ''}>No Asignados</option>
                    </select>
                </div>
                
                <div class="flex items-center gap-3 w-full lg:w-auto">
                    <button onclick="toggleAllTeamProducts()" class="px-5 py-4 bg-gray-100 hover:bg-gray-200 rounded-2xl text-[9px] font-black uppercase tracking-wider transition-colors border-none cursor-pointer">
                        Seleccionar Visibles
                    </button>
                    <button onclick="saveTeamAssignments()" class="flex-1 lg:flex-none px-8 py-4 bg-black text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-gray-900 active:scale-95 transition-all cursor-pointer border-none">
                        Guardar Cambios
                    </button>
                </div>
            </div>

            <!-- Resumen numérico -->
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">
                Total marcados: <span id="team-marked-count" class="text-black font-black">${adminState.teamPendingAssign.size}</span>
            </p>

            <!-- Grid de Productos -->
            <div id="team-products-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                <!-- Se llena vía renderTeamGrid() -->
            </div>
        </div>
    `;
    renderTeamGrid();
}

function renderTeamGrid() {
    const grid = document.getElementById('team-products-grid');
    if (!grid) return;
    const countEl = document.getElementById('team-marked-count');
    if (countEl) countEl.innerText = adminState.teamPendingAssign.size;

    const contact = adminState.contacts.find(c => c.id == adminState.selectedUserId);

    let filtered = adminState.products.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(adminState.teamSearchQuery.toLowerCase());
        const isAssignedToThis = adminState.teamPendingAssign.has(p.id);
        
        if (adminState.teamFilterMode === 'assigned') return matchesSearch && isAssignedToThis;
        if (adminState.teamFilterMode === 'unassigned') return matchesSearch && !isAssignedToThis;
        return matchesSearch;
    });

    adminState.teamCurrentVisible = filtered.map(p => p.id);

    grid.innerHTML = filtered.map(p => {
        const isChecked = adminState.teamPendingAssign.has(p.id);
        return `
            <div onclick="toggleTeamProduct(${p.id})" class="relative flex items-center p-3 rounded-2xl border-2 cursor-pointer transition-all ${isChecked ? 'border-black bg-gray-50' : 'border-gray-100 hover:border-gray-200'}">
                <div class="w-5 h-5 rounded flex items-center justify-center mr-3 flex-shrink-0 transition-colors ${isChecked ? 'bg-black text-white' : 'bg-gray-200 text-transparent'}">
                    <i class="fa-solid fa-check text-[10px]"></i>
                </div>
                <img src="${p.images[0]}" class="w-10 h-10 rounded-xl object-cover flex-shrink-0">
                <div class="ml-3 min-w-0 flex-1">
                    <p class="text-[10px] font-black uppercase truncate leading-tight">${p.name}</p>
                    <p class="text-[9px] font-bold text-gray-400 mt-0.5 truncate">
                        ${p.contactId && p.contactId != contact.id && !isChecked ? `<span class="text-amber-500"><i class="fa-solid fa-triangle-exclamation mr-1"></i>De otro vendedor</span>` : 'Disponible'}
                    </p>
                </div>
            </div>
        `;
    }).join('') + (filtered.length === 0 ? '<div class="col-span-full py-12 text-center text-gray-400 text-xs font-bold uppercase tracking-widest">No hay resultados</div>' : '');
}

window.updateTeamSearch = (val) => {
    adminState.teamSearchQuery = val;
    renderTeamGrid();
};

window.updateTeamFilter = (val) => {
    adminState.teamFilterMode = val;
    renderTeamGrid();
};

window.toggleTeamProduct = (id) => {
    if (adminState.teamPendingAssign.has(id)) adminState.teamPendingAssign.delete(id);
    else adminState.teamPendingAssign.add(id);
    renderTeamGrid();
};

window.toggleAllTeamProducts = () => {
    const ids = adminState.teamCurrentVisible || [];
    if (ids.length === 0) return;
    const allSelected = ids.every(id => adminState.teamPendingAssign.has(id));
    if (allSelected) {
        ids.forEach(id => adminState.teamPendingAssign.delete(id));
    } else {
        ids.forEach(id => adminState.teamPendingAssign.add(id));
    }
    renderTeamGrid();
};

window.saveTeamAssignments = async () => {
    const contactId = adminState.selectedUserId;
    const productIds = Array.from(adminState.teamPendingAssign);
    
    const toast = document.getElementById('admin-toast');
    if(toast) {
        toast.innerHTML = `<div class="bg-black text-white px-8 py-4 rounded-2xl shadow-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2"><i class="fa-solid fa-circle-notch animate-spin"></i> Guardando...</div>`;
        toast.classList.remove('hidden');
    }

    try {
        const res = await fetch(`/api/admin/contacts/${contactId}/assign-products`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productIds })
        });
        
        if (res.ok) {
            // Actualizar caché local
            adminState.products.forEach(p => {
                if (p.contactId == contactId) p.contactId = null;
                if (adminState.teamPendingAssign.has(p.id)) p.contactId = contactId;
            });
            showAdminToast('¡Asignaciones guardadas!');
            setTimeout(() => goBackAdmin(), 1000);
        } else {
            showAdminToast('Error al guardar');
        }
    } catch (err) {
        showAdminToast('Error de conexión');
    }
};

async function handleTeamSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    loadAdminData();
}

function renderLogsView(container) {
    container.innerHTML = `
        <h2 class="text-2xl md:text-4xl font-black uppercase tracking-tighter mb-8 md:mb-12">Historial</h2>
        <div class="bg-white rounded-[2rem] md:rounded-[3rem] shadow-sm overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-left min-w-[500px]">
                    <thead class="bg-gray-50 border-b">
                        <tr><th class="p-4 md:p-6 text-[10px] font-black uppercase">Acción</th><th class="p-4 md:p-6 text-[10px] font-black uppercase">Detalle</th><th class="p-4 md:p-6 text-[10px] font-black uppercase">Fecha</th></tr>
                    </thead>
                    <tbody>
                        ${adminState.logs.map(l => `<tr class="border-b hover:bg-gray-50">
                            <td class="p-4 md:p-6"><span class="px-3 py-1 bg-black text-white text-[8px] font-black rounded-full uppercase">${l.action}</span></td>
                            <td class="p-4 md:p-6 text-[11px] font-medium">${l.detail}</td>
                            <td class="p-4 md:p-6 text-[10px] opacity-40 font-bold">${l.timestamp}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function renderSettingsView(container) {
    container.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fade">
            <div class="bg-white p-8 md:p-12 rounded-[2rem] md:rounded-[3.5rem] shadow-xl">
                <h2 class="text-xl md:text-2xl font-black mb-6 md:mb-8 uppercase tracking-tighter">Seguridad</h2>
                <div class="space-y-4">
                    <input type="password" id="new-pass-1" placeholder="Nueva Contraseña" class="w-full p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase">
                    <input type="password" id="new-pass-2" placeholder="Confirmar" class="w-full p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase">
                    <button onclick="updatePassword()" class="w-full bg-black text-white py-4 md:py-5 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl cursor-pointer hover:scale-[1.02] active:scale-95 transition-all">Actualizar</button>
                </div>
            </div>

            <div class="bg-white p-8 md:p-12 rounded-[2rem] md:rounded-[3.5rem] shadow-xl">
                <h2 class="text-xl md:text-2xl font-black mb-6 md:mb-8 uppercase tracking-tighter">Correos y Cuotas</h2>
                <div id="email-settings-content" class="text-center py-8">
                    <i class="fa-solid fa-spinner fa-spin text-2xl text-gray-300"></i>
                </div>
            </div>
        </div>
    `;
    loadEmailSettings();
}

async function loadEmailSettings() {
    try {
        const res = await fetch('/api/admin/email-settings');
        const data = await res.json();
        const container = document.getElementById('email-settings-content');
        if (!container) return;

        const { config, env } = data;
        const method = config.active_client_method;

        container.innerHTML = `
            <div class="space-y-6 text-left">
                <!-- Admins -->
                <div class="p-5 bg-gray-50 rounded-2xl">
                    <p class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Alertas Admin (Gmail 1)</p>
                    <p class="font-bold text-sm mb-2">${env.gmailAdmin}</p>
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold bg-black text-white px-3 py-1 rounded-full">${config.count_admin_daily} hoy</span>
                        <span class="text-[9px] text-gray-400 uppercase tracking-widest font-bold">Reseteo Diario</span>
                    </div>
                </div>

                <!-- Clientes: Gmail 2 -->
                <div class="p-5 rounded-2xl transition-all border-2 ${method === 'gmail2' ? 'border-black bg-white shadow-lg' : 'border-transparent bg-gray-50 opacity-60'}">
                    <div class="flex items-start justify-between mb-2">
                        <div>
                            <p class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Clientes (Gmail Secundario)</p>
                            <p class="font-bold text-sm">${env.gmail2}</p>
                        </div>
                        <button onclick="toggleEmailMethod('gmail2')" class="${method === 'gmail2' ? 'bg-black text-white' : 'bg-gray-200 text-gray-500'} px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all">
                            ${method === 'gmail2' ? 'Activo' : 'Activar'}
                        </button>
                    </div>
                    <div class="flex items-center justify-between mt-4">
                        <span class="text-xs font-bold ${method === 'gmail2' ? 'bg-black text-white' : 'bg-gray-200 text-gray-500'} px-3 py-1 rounded-full">${config.count_gmail2_daily} hoy</span>
                        <span class="text-[9px] text-gray-400 uppercase tracking-widest font-bold">Reseteo Diario</span>
                    </div>
                </div>

                <!-- Clientes: SendPulse -->
                <div class="p-5 rounded-2xl transition-all border-2 ${method === 'sendpulse' ? 'border-black bg-white shadow-lg' : 'border-transparent bg-gray-50 opacity-60'}">
                    <div class="flex items-start justify-between mb-2">
                        <div>
                            <p class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Clientes (API SendPulse)</p>
                            <p class="font-bold text-sm">${env.sendpulseSender}</p>
                        </div>
                        <button onclick="toggleEmailMethod('sendpulse')" class="${method === 'sendpulse' ? 'bg-black text-white' : 'bg-gray-200 text-gray-500'} px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all">
                            ${method === 'sendpulse' ? 'Activo' : 'Activar'}
                        </button>
                    </div>
                    <div class="flex items-center justify-between mt-4">
                        <span class="text-xs font-bold ${method === 'sendpulse' ? 'bg-black text-white' : 'bg-gray-200 text-gray-500'} px-3 py-1 rounded-full">${config.count_sendpulse_total} en total</span>
                        <span class="text-[9px] text-gray-400 uppercase tracking-widest font-bold">Acumulativo</span>
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        console.error(err);
    }
}

async function toggleEmailMethod(method) {
    try {
        await fetch('/api/admin/email-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active_client_method: method })
        });
        loadEmailSettings();
    } catch (err) {
        alert("Error al cambiar el método.");
    }
}

async function updatePassword() {
    const p1 = document.getElementById('new-pass-1').value;
    const p2 = document.getElementById('new-pass-2').value;
    if (p1 !== p2 || p1.length < 4) return alert("Error en contraseñas.");
    await fetch('/api/admin/update-password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword: p1 }) });
    logoutAdmin();
}

async function deleteAction(table, id, name = 'el registro') {
    if (confirm(`¿Eliminar ${name}?`)) {
        await fetch(`/api/${table}/${id}`, { method: 'DELETE' });
        loadAdminData();
    }
}

// =============================================
// VISTA: USUARIOS (Tarjetas responsivas)
// =============================================
function renderUsersView(container) {
    container.innerHTML = `
        <h2 class="text-2xl md:text-4xl font-black uppercase tracking-tighter mb-8 md:mb-12 animate-fade">Usuarios</h2>
        ${adminState.users.length === 0 ? `
            <div class="bg-white rounded-[2rem] p-12 text-center shadow-sm">
                <i class="fa-solid fa-users text-4xl text-gray-200 mb-4"></i>
                <p class="text-xs font-bold text-gray-400 uppercase tracking-widest">No hay usuarios registrados</p>
            </div>
        ` : `
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                ${adminState.users.map(u => {
                    const date = formatDate(u.created_at);
                    const orderCount = adminState.orders.filter(o => o.user_id === u.id).length;
                    return `
                        <div onclick="setAdminView('user-detail', { userId: '${u.id}', tab: 'profile' })" 
                             class="bg-white p-5 md:p-6 rounded-2xl md:rounded-[2rem] shadow-sm hover:shadow-md transition-all cursor-pointer group border border-transparent hover:border-gray-200">
                            <div class="flex items-center gap-4 mb-4">
                                ${u.avatar_url 
                                    ? `<img src="${u.avatar_url}" class="w-12 h-12 rounded-full object-cover border-2 border-gray-100 flex-shrink-0 group-hover:scale-105 transition-transform">` 
                                    : `<div class="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0"><i class="fa-solid fa-user text-gray-400"></i></div>`}
                                <div class="min-w-0 flex-1">
                                    <p class="text-xs font-black uppercase truncate">${u.full_name || 'Sin Nombre'}</p>
                                    <p class="text-[10px] font-bold text-gray-400 truncate">${u.email || '-'}</p>
                                </div>
                                <i class="fa-solid fa-chevron-right text-gray-300 group-hover:text-black transition-colors text-xs"></i>
                            </div>
                            <div class="flex gap-3 text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                                <span><i class="fa-solid fa-box mr-1"></i>${orderCount} pedido${orderCount !== 1 ? 's' : ''}</span>
                                <span><i class="fa-regular fa-clock mr-1"></i>${date.split(',')[0]}</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `}
    `;
}

// =============================================
// VISTA: PEDIDOS (Estilo Google Fotos — Agrupados por fecha)
// =============================================
function renderOrdersView(container) {
    if (adminState.orders.length === 0) {
        container.innerHTML = `
            <h2 class="text-2xl md:text-4xl font-black uppercase tracking-tighter mb-8 md:mb-12 animate-fade">Pedidos</h2>
            <div class="bg-white rounded-[2rem] p-12 text-center shadow-sm">
                <i class="fa-solid fa-box-open text-4xl text-gray-200 mb-4"></i>
                <p class="text-xs font-bold text-gray-400 uppercase tracking-widest">No hay pedidos registrados</p>
            </div>
        `;
        return;
    }

    // Agrupar por fecha
    const groups = {};
    adminState.orders.forEach(o => {
        const label = getDateLabel(o.created_at);
        if (!groups[label]) groups[label] = [];
        groups[label].push(o);
    });

    let html = `
        <h2 class="text-2xl md:text-4xl font-black uppercase tracking-tighter mb-8 md:mb-12 animate-fade">Pedidos</h2>
    `;

    Object.entries(groups).forEach(([label, orders]) => {
        html += `
            <div class="mb-6 md:mb-8">
                <div class="flex items-center gap-3 mb-3 md:mb-4">
                    <h3 class="text-[11px] md:text-xs font-black uppercase tracking-widest text-gray-400">${label}</h3>
                    <div class="flex-1 h-px bg-gray-200"></div>
                    <span class="text-[10px] font-bold text-gray-300">${orders.length}</span>
                </div>
                <div class="space-y-2 md:space-y-3">
                    ${orders.map(o => renderOrderCard(o)).join('')}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderOrderCard(o) {
    const isExpanded = adminState.expandedOrders.has(o.id);
    const items = o.order_items || [];
    const time = new Date(o.created_at).toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit' });
    const colorClass = statusColors[o.status] || 'bg-gray-100 text-gray-700';

    let expandedHTML = '';
    if (isExpanded) {
        expandedHTML = `
            <div class="mt-4 pt-4 border-t border-gray-100 animate-fade">
                <!-- Productos -->
                <div class="flex flex-wrap gap-2 mb-4">
                    ${items.map(item => `
                        <div class="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-xl">
                            ${item.product_image ? `<img src="${item.product_image}" class="w-8 h-8 rounded-lg object-cover">` : ''}
                            <div>
                                <p class="text-[9px] font-black uppercase truncate max-w-[120px]">${item.product_name}</p>
                                <p class="text-[8px] text-gray-400 font-bold">x${item.quantity} · BOB ${Number(item.price).toFixed(2)}</p>
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                <!-- Resumen rápido -->
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div class="text-left">
                        <p class="text-[8px] font-black uppercase text-gray-400 tracking-wider">Total</p>
                        <p class="text-sm font-black">BOB ${Number(o.total).toFixed(2)}</p>
                    </div>
                    <div class="text-left">
                        <p class="text-[8px] font-black uppercase text-gray-400 tracking-wider">Vendedor</p>
                        <p class="text-[11px] font-bold">${o.seller_name || '-'}</p>
                    </div>
                    <div class="text-left">
                        <p class="text-[8px] font-black uppercase text-gray-400 tracking-wider">Celular</p>
                        <p class="text-[11px] font-bold">${o.contact_phone || '-'}</p>
                    </div>
                    <div class="text-left">
                        <p class="text-[8px] font-black uppercase text-gray-400 tracking-wider">Envío</p>
                        <p class="text-[11px] font-bold">${o.shipping_method === 'express' ? 'Express' : 'Gratis'}</p>
                    </div>
                </div>

                <!-- Estado -->
                <div class="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                    <div class="flex items-center gap-2">
                        <span class="text-[9px] font-black uppercase tracking-wider text-gray-400">Estado:</span>
                        <select onchange="updateOrderStatus(${o.id}, this.value)" class="p-2 rounded-lg text-[10px] font-bold outline-none cursor-pointer border border-gray-200 ${colorClass}">
                            <option value="confirmado" ${o.status === 'confirmado' ? 'selected' : ''}>Confirmado</option>
                            <option value="en_proceso" ${o.status === 'en_proceso' ? 'selected' : ''}>En Proceso</option>
                            <option value="enviado" ${o.status === 'enviado' ? 'selected' : ''}>Enviado</option>
                            <option value="entregado" ${o.status === 'entregado' ? 'selected' : ''}>Entregado</option>
                            <option value="cancelado" ${o.status === 'cancelado' ? 'selected' : ''}>Cancelado</option>
                        </select>
                    </div>
                    <button onclick="event.stopPropagation(); setAdminView('order-detail', { orderId: ${o.id}, tab: 'order' })" 
                            class="bg-black text-white px-5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-wider hover:bg-gray-900 active:scale-95 transition-all cursor-pointer border-none">
                        Ver detalle completo <i class="fa-solid fa-arrow-right ml-1"></i>
                    </button>
                </div>
            </div>
        `;
    }

    return `
        <div class="bg-white rounded-2xl md:rounded-[1.5rem] shadow-sm border border-gray-100 overflow-hidden hover:border-gray-200 transition-all">
            <div onclick="toggleOrderExpand(${o.id})" class="flex items-center gap-3 md:gap-4 p-4 md:p-5 cursor-pointer select-none">
                <!-- Badge de estado compacto -->
                <div class="w-2 h-2 rounded-full flex-shrink-0 ${o.status === 'entregado' ? 'bg-emerald-500' : o.status === 'cancelado' ? 'bg-red-500' : o.status === 'enviado' ? 'bg-purple-500' : o.status === 'en_proceso' ? 'bg-amber-500' : 'bg-blue-500'}"></div>
                
                <!-- Info principal -->
                <div class="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                    <span class="text-xs md:text-sm font-black uppercase tracking-tight truncate max-w-[100px] sm:max-w-none">${(o.contact_name || 'Visitante').split(' ')[0]}</span>
                    <span class="text-[10px] md:text-[11px] font-bold text-gray-500 whitespace-nowrap">${o.contact_phone || '-'}</span>
                    <span class="text-[10px] md:text-[11px] font-medium text-gray-400 truncate flex-1">${items.map(i => i.quantity + 'x ' + i.product_name).join(', ')}</span>
                </div>

                <!-- Hora + Badge + Flecha -->
                <div class="flex items-center gap-2 md:gap-3 flex-shrink-0">
                    <span class="hidden sm:inline text-[9px] font-bold text-gray-400">${time}</span>
                    <span class="px-2 py-1 rounded-lg text-[8px] font-black uppercase ${colorClass}">${statusLabels[o.status] || o.status}</span>
                    <i class="fa-solid fa-chevron-down text-gray-300 text-xs transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}"></i>
                </div>
            </div>
            ${expandedHTML}
        </div>
    `;
}

window.toggleOrderExpand = (orderId) => {
    if (adminState.expandedOrders.has(orderId)) {
        adminState.expandedOrders.delete(orderId);
    } else {
        adminState.expandedOrders.add(orderId);
    }
    renderAdmin();
};

// =============================================
// VISTA FULL-PAGE: DETALLE DE PEDIDO (Pestañas Pedido/Perfil)
// =============================================
async function renderOrderDetailView(container) {
    const orderId = adminState.selectedOrderId;
    if (!orderId) { goBackAdmin(); return; }

    container.innerHTML = `
        <div class="flex items-center justify-center py-20 opacity-30">
            <i class="fa-solid fa-circle-notch animate-spin text-3xl"></i>
        </div>
    `;

    try {
        const res = await fetch(`/api/admin/orders/${orderId}`);
        const { order: o, userProfile } = await res.json();
        if (!o) { goBackAdmin(); return; }

        const items = o.order_items || [];
        const date = formatDate(o.created_at);
        const colorClass = statusColors[o.status] || 'bg-gray-100';
        const tab = adminState.detailTab;

        container.innerHTML = `
            ${renderBackHeader(`Pedido #${o.order_number}`, date)}
            
            <!-- Pestañas -->
            <div class="flex gap-1 bg-gray-100 p-1 rounded-2xl mb-8 max-w-xs">
                <button onclick="switchDetailTab('order')" class="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border-none ${tab === 'order' ? 'bg-black text-white shadow-md' : 'bg-transparent text-gray-500 hover:text-black'}">
                    <i class="fa-solid fa-box mr-1"></i> Pedido
                </button>
                <button onclick="switchDetailTab('profile')" class="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border-none ${tab === 'profile' ? 'bg-black text-white shadow-md' : 'bg-transparent text-gray-500 hover:text-black'}">
                    <i class="fa-solid fa-user mr-1"></i> Perfil
                </button>
            </div>

            <div id="detail-tab-content" class="animate-fade">
                ${tab === 'order' ? renderOrderTabContent(o, items) : renderProfileTabFromOrder(o, userProfile)}
            </div>
        `;
    } catch (err) {
        console.error(err);
        container.innerHTML = renderBackHeader('Error') + '<p class="text-red-500 text-sm">No se pudo cargar el pedido.</p>';
    }
}

function renderOrderTabContent(o, items) {
    const colorClass = statusColors[o.status] || 'bg-gray-100';
    
    return `
        <!-- Estado y Total -->
        <div class="bg-white rounded-2xl md:rounded-[2rem] p-5 md:p-8 shadow-sm mb-4 md:mb-6">
            <div class="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
                <div>
                    <p class="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Estado del Pedido</p>
                    <select onchange="updateOrderStatus(${o.id}, this.value)" class="p-3 rounded-xl text-xs font-bold outline-none cursor-pointer border border-gray-200 shadow-sm ${colorClass}">
                        <option value="confirmado" ${o.status === 'confirmado' ? 'selected' : ''}>Confirmado</option>
                        <option value="en_proceso" ${o.status === 'en_proceso' ? 'selected' : ''}>En Proceso</option>
                        <option value="enviado" ${o.status === 'enviado' ? 'selected' : ''}>Enviado</option>
                        <option value="entregado" ${o.status === 'entregado' ? 'selected' : ''}>Entregado</option>
                        <option value="cancelado" ${o.status === 'cancelado' ? 'selected' : ''}>Cancelado</option>
                    </select>
                </div>
                <div class="text-left sm:text-right">
                    <p class="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Total</p>
                    <p class="text-3xl md:text-4xl font-black tracking-tight">BOB ${Number(o.total).toFixed(2)}</p>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-4 md:mb-6">
            <!-- Datos del Cliente -->
            <div class="bg-white rounded-2xl md:rounded-[2rem] p-5 md:p-8 shadow-sm text-left">
                <h3 class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 pb-3 border-b border-gray-100">
                    <i class="fa-solid fa-user mr-2"></i>Cliente
                </h3>
                <div class="space-y-3">
                    <div><p class="text-[9px] font-bold text-gray-400 uppercase">Nombre</p><p class="text-sm font-bold">${o.contact_name || 'Visitante'}</p></div>
                    <div><p class="text-[9px] font-bold text-gray-400 uppercase">Correo</p><p class="text-sm font-bold">${o.contact_email || '-'}</p></div>
                    <div>
                        <p class="text-[9px] font-bold text-gray-400 uppercase">Celular</p>
                        ${o.contact_phone ? `
                            <a href="https://wa.me/${o.contact_phone.replace(/\\D/g, '')}" target="_blank" class="text-sm font-bold text-green-600 hover:underline inline-flex items-center gap-1">
                                <i class="fa-brands fa-whatsapp"></i> ${o.contact_phone}
                            </a>
                        ` : '<p class="text-sm font-bold">-</p>'}
                    </div>
                </div>
            </div>

            <!-- Dirección -->
            <div class="bg-white rounded-2xl md:rounded-[2rem] p-5 md:p-8 shadow-sm text-left">
                <h3 class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 pb-3 border-b border-gray-100">
                    <i class="fa-solid fa-location-dot mr-2"></i>Entrega
                </h3>
                <div class="space-y-3">
                    <div><p class="text-[9px] font-bold text-gray-400 uppercase">Ciudad / Departamento</p><p class="text-sm font-bold">${o.shipping_city || '-'}, ${o.shipping_department || '-'}</p></div>
                    <div><p class="text-[9px] font-bold text-gray-400 uppercase">Dirección</p><p class="text-sm font-bold">${o.shipping_address || '-'}</p></div>
                    ${o.shipping_apartment ? `<div><p class="text-[9px] font-bold text-gray-400 uppercase">Detalle / Piso</p><p class="text-sm font-bold">${o.shipping_apartment}</p></div>` : ''}
                    ${o.shipping_door_desc ? `<div><p class="text-[9px] font-bold text-gray-400 uppercase">Fachada / Puerta</p><p class="text-sm font-bold">${o.shipping_door_desc}</p></div>` : ''}
                    ${o.shipping_maps_link ? `
                        <a href="${o.shipping_maps_link}" target="_blank" class="inline-flex items-center gap-2 mt-2 px-4 py-2.5 bg-blue-50 text-blue-600 rounded-xl font-bold text-[10px] hover:bg-blue-100 transition-colors">
                            <i class="fa-solid fa-map-location-dot"></i> Abrir en Google Maps
                        </a>
                    ` : ''}
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-4 md:mb-6">
            <!-- Resumen Financiero -->
            <div class="bg-white rounded-2xl md:rounded-[2rem] p-5 md:p-8 shadow-sm">
                <h3 class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 pb-3 border-b border-gray-100 text-left">
                    <i class="fa-solid fa-receipt mr-2"></i>Resumen Financiero
                </h3>
                <div class="bg-gray-50 p-4 md:p-5 rounded-2xl space-y-3">
                    <div class="flex justify-between text-sm"><span class="text-gray-500 font-bold">Subtotal</span><span class="font-bold">BOB ${Number(o.subtotal).toFixed(2)}</span></div>
                    <div class="flex justify-between text-sm"><span class="text-gray-500 font-bold">Envío (${o.shipping_method === 'express' ? 'Express' : 'Gratis'})</span><span class="font-bold">BOB ${Number(o.shipping_cost).toFixed(2)}</span></div>
                    <div class="border-t border-gray-200 pt-3 flex justify-between text-lg font-black"><span>Total</span><span>BOB ${Number(o.total).toFixed(2)}</span></div>
                </div>
            </div>

            <!-- Vendedor y Método de Pago -->
            <div class="bg-white rounded-2xl md:rounded-[2rem] p-5 md:p-8 shadow-sm text-left">
                <h3 class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 pb-3 border-b border-gray-100">
                    <i class="fa-solid fa-store mr-2"></i>Vendedor y Pago
                </h3>
                <div class="space-y-4">
                    <div>
                        <p class="text-[9px] font-bold text-gray-400 uppercase">Vendedor Asignado</p>
                        <p class="text-sm font-bold"><i class="fa-brands fa-whatsapp text-green-500 mr-1"></i>${o.seller_name || '-'}</p>
                    </div>
                    ${o.seller_number ? `<div><p class="text-[9px] font-bold text-gray-400 uppercase">Número Vendedor</p><p class="text-sm font-bold">${o.seller_number}</p></div>` : ''}
                    <div>
                        <p class="text-[9px] font-bold text-gray-400 uppercase">Método de Envío</p>
                        <p class="text-sm font-bold">${o.shipping_method === 'express' ? 'Delivery Express (BOB 15.00)' : 'Gratis (Punto de Encuentro)'}</p>
                    </div>
                    <div>
                        <p class="text-[9px] font-bold text-gray-400 uppercase">Método de Pago</p>
                        <p class="text-sm font-bold">Pago contra entrega</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Productos -->
        <div class="bg-white rounded-2xl md:rounded-[2rem] p-5 md:p-8 shadow-sm">
            <h3 class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 pb-3 border-b border-gray-100 text-left">
                <i class="fa-solid fa-bag-shopping mr-2"></i>Productos (${items.length})
            </h3>
            <div class="space-y-3">
                ${items.map(item => `
                    <div class="flex items-center justify-between bg-gray-50 p-3 md:p-4 rounded-xl md:rounded-2xl">
                        <div class="flex items-center gap-3 md:gap-4 min-w-0">
                            ${item.product_image ? `<img src="${item.product_image}" class="w-14 h-14 md:w-16 md:h-16 rounded-xl object-cover shadow-sm flex-shrink-0">` : `<div class="w-14 h-14 md:w-16 md:h-16 bg-gray-200 rounded-xl flex-shrink-0"></div>`}
                            <div class="min-w-0">
                                <p class="font-black uppercase text-xs md:text-sm truncate">${item.product_name}</p>
                                <p class="text-[10px] font-bold text-gray-500">Cantidad: ${item.quantity}</p>
                            </div>
                        </div>
                        <div class="text-right flex-shrink-0 ml-3">
                            <p class="text-[9px] font-bold text-gray-400">Precio Unit.</p>
                            <p class="font-black text-sm">BOB ${Number(item.price).toFixed(2)}</p>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderProfileTabFromOrder(o, userProfile) {
    if (!userProfile) {
        return `
            <div class="bg-white rounded-2xl md:rounded-[2rem] p-8 md:p-12 text-center shadow-sm">
                <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="fa-solid fa-user-secret text-2xl text-gray-400"></i>
                </div>
                <h3 class="text-lg font-black uppercase mb-2">Compra como Visitante</h3>
                <p class="text-xs text-gray-500 font-bold mb-4">Este pedido fue realizado sin una cuenta registrada.</p>
                <div class="bg-gray-50 rounded-2xl p-5 inline-block text-left">
                    <p class="text-[9px] font-bold text-gray-400 uppercase mb-1">Datos de contacto del pedido</p>
                    <p class="text-sm font-bold">${o.contact_name || '-'}</p>
                    <p class="text-xs text-gray-500">${o.contact_email || '-'}</p>
                    <p class="text-xs text-gray-500">${o.contact_phone || '-'}</p>
                </div>
            </div>
        `;
    }
    
    // Cargar los pedidos de este usuario para mostrar en perfil
    const userOrders = adminState.orders.filter(order => order.user_id === userProfile.id);
    
    return `
        <!-- Info del usuario -->
        <div class="bg-white rounded-2xl md:rounded-[2rem] p-5 md:p-8 shadow-sm mb-4 md:mb-6">
            <div class="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                ${userProfile.avatar_url 
                    ? `<img src="${userProfile.avatar_url}" class="w-20 h-20 rounded-full object-cover border-2 border-gray-100 shadow-md">` 
                    : `<div class="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center"><i class="fa-solid fa-user text-2xl text-gray-400"></i></div>`}
                <div class="text-left">
                    <h3 class="text-xl font-black uppercase tracking-tight">${userProfile.full_name || 'Sin Nombre'}</h3>
                    <p class="text-xs font-bold text-gray-500">${userProfile.email || '-'}</p>
                    <p class="text-[10px] font-bold text-gray-400 mt-1"><i class="fa-regular fa-clock mr-1"></i>Registrado: ${formatDate(userProfile.created_at)}</p>
                </div>
            </div>
        </div>

        <!-- Pedidos del usuario -->
        <div class="bg-white rounded-2xl md:rounded-[2rem] p-5 md:p-8 shadow-sm">
            <h3 class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 pb-3 border-b border-gray-100 text-left">
                Historial de pedidos (${userOrders.length})
            </h3>
            ${userOrders.length === 0 ? '<p class="text-xs text-gray-400 text-center py-6">Sin pedidos</p>' : `
                <div class="space-y-2">
                    ${userOrders.map(uo => `
                        <div onclick="setAdminView('order-detail', { orderId: ${uo.id}, tab: 'order' })" 
                             class="flex items-center justify-between p-3 md:p-4 bg-gray-50 rounded-xl hover:bg-gray-100 cursor-pointer transition-colors">
                            <div class="flex items-center gap-3 min-w-0">
                                <div class="w-2 h-2 rounded-full flex-shrink-0 ${uo.status === 'entregado' ? 'bg-emerald-500' : uo.status === 'cancelado' ? 'bg-red-500' : 'bg-blue-500'}"></div>
                                <div class="min-w-0">
                                    <span class="text-[11px] font-black uppercase">#${uo.order_number}</span>
                                    <p class="text-[9px] font-bold text-gray-400">${formatDate(uo.created_at).split(',')[0]}</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-black">BOB ${Number(uo.total).toFixed(2)}</span>
                                <i class="fa-solid fa-chevron-right text-gray-300 text-xs"></i>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
        </div>
    `;
}

window.switchDetailTab = (tab) => {
    setAdminView(adminState.view, { orderId: adminState.selectedOrderId, userId: adminState.selectedUserId, tab });
};

// =============================================
// VISTA FULL-PAGE: DETALLE DE USUARIO (Pestañas Perfil/Pedidos)
// =============================================
async function renderUserDetailView(container) {
    const userId = adminState.selectedUserId;
    if (!userId) { goBackAdmin(); return; }

    container.innerHTML = `
        <div class="flex items-center justify-center py-20 opacity-30">
            <i class="fa-solid fa-circle-notch animate-spin text-3xl"></i>
        </div>
    `;

    try {
        const res = await fetch(`/api/admin/users/${userId}`);
        const { profile, addresses, orders } = await res.json();
        if (!profile) { goBackAdmin(); return; }

        const tab = adminState.detailTab;

        container.innerHTML = `
            ${renderBackHeader(profile.full_name || 'Usuario', profile.email || '')}
            
            <!-- Pestañas -->
            <div class="flex gap-1 bg-gray-100 p-1 rounded-2xl mb-8 max-w-xs">
                <button onclick="setAdminView('user-detail', { userId: adminState.selectedUserId, tab: 'profile' })" class="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border-none ${tab === 'profile' ? 'bg-black text-white shadow-md' : 'bg-transparent text-gray-500 hover:text-black'}">
                    <i class="fa-solid fa-user mr-1"></i> Perfil
                </button>
                <button onclick="setAdminView('user-detail', { userId: adminState.selectedUserId, tab: 'orders' })" class="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border-none ${tab === 'orders' ? 'bg-black text-white shadow-md' : 'bg-transparent text-gray-500 hover:text-black'}">
                    <i class="fa-solid fa-box mr-1"></i> Pedidos
                </button>
            </div>

            <div id="user-detail-content" class="animate-fade">
                ${tab === 'profile' ? renderUserProfileTab(profile, addresses, orders) : renderUserOrdersTab(orders)}
            </div>
        `;
    } catch (err) {
        console.error(err);
        container.innerHTML = renderBackHeader('Error') + '<p class="text-red-500 text-sm">No se pudo cargar el usuario.</p>';
    }
}

function renderUserProfileTab(profile, addresses, orders) {
    return `
        <!-- Tarjeta de perfil -->
        <div class="bg-white rounded-2xl md:rounded-[2rem] p-5 md:p-8 shadow-sm mb-4 md:mb-6">
            <div class="flex flex-col sm:flex-row items-start sm:items-center gap-5 mb-6">
                ${profile.avatar_url 
                    ? `<img src="${profile.avatar_url}" class="w-24 h-24 rounded-full object-cover border-2 border-gray-100 shadow-lg">` 
                    : `<div class="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center"><i class="fa-solid fa-user text-3xl text-gray-400"></i></div>`}
                <div class="text-left">
                    <h3 class="text-2xl font-black uppercase tracking-tight">${profile.full_name || 'Sin Nombre'}</h3>
                    <p class="text-sm font-bold text-gray-500">${profile.email || '-'}</p>
                    ${profile.phone ? `<p class="text-sm font-bold text-gray-500"><i class="fa-solid fa-phone mr-1"></i>${profile.phone}</p>` : ''}
                    <p class="text-[10px] font-bold text-gray-400 mt-2"><i class="fa-regular fa-clock mr-1"></i>Registro: ${formatDate(profile.created_at)}</p>
                </div>
            </div>

            <!-- Stats rápidos -->
            <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div class="bg-gray-50 rounded-xl p-4 text-center">
                    <p class="text-2xl font-black">${orders.length}</p>
                    <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Pedidos</p>
                </div>
                <div class="bg-gray-50 rounded-xl p-4 text-center">
                    <p class="text-2xl font-black">${addresses.length}</p>
                    <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Direcciones</p>
                </div>
                <div class="bg-gray-50 rounded-xl p-4 text-center col-span-2 md:col-span-1">
                    <p class="text-2xl font-black">BOB ${orders.reduce((sum, o) => sum + Number(o.total), 0).toFixed(0)}</p>
                    <p class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Total Gastado</p>
                </div>
            </div>
        </div>

        <!-- Direcciones -->
        ${addresses.length > 0 ? `
            <div class="bg-white rounded-2xl md:rounded-[2rem] p-5 md:p-8 shadow-sm">
                <h3 class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 pb-3 border-b border-gray-100 text-left">
                    <i class="fa-solid fa-location-dot mr-2"></i>Direcciones Guardadas (${addresses.length})
                </h3>
                <div class="space-y-3">
                    ${addresses.map(a => `
                        <div class="bg-gray-50 p-4 rounded-xl text-left">
                            <div class="flex items-center gap-2 mb-2">
                                <span class="text-[10px] font-black uppercase">${a.label || 'Casa'}</span>
                                ${a.is_default ? '<span class="text-[8px] font-black uppercase bg-black text-white px-2 py-0.5 rounded-full">Predeterminada</span>' : ''}
                            </div>
                            <p class="text-xs font-bold">${a.street || '-'}</p>
                            <p class="text-[11px] text-gray-500">${a.city}, ${a.department || 'Cochabamba'}</p>
                            ${a.maps_link ? `<a href="${a.maps_link}" target="_blank" class="text-[10px] text-blue-600 font-bold hover:underline"><i class="fa-solid fa-map mr-1"></i>Ver mapa</a>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}
    `;
}

function renderUserOrdersTab(orders) {
    if (orders.length === 0) {
        return `
            <div class="bg-white rounded-2xl p-12 text-center shadow-sm">
                <i class="fa-solid fa-box-open text-4xl text-gray-200 mb-4"></i>
                <p class="text-xs font-bold text-gray-400 uppercase tracking-widest">Este usuario no tiene pedidos</p>
            </div>
        `;
    }

    // Agrupar por fecha
    const groups = {};
    orders.forEach(o => {
        const label = getDateLabel(o.created_at);
        if (!groups[label]) groups[label] = [];
        groups[label].push(o);
    });

    let html = '';
    Object.entries(groups).forEach(([label, groupOrders]) => {
        html += `
            <div class="mb-6">
                <div class="flex items-center gap-3 mb-3">
                    <h3 class="text-[11px] font-black uppercase tracking-widest text-gray-400">${label}</h3>
                    <div class="flex-1 h-px bg-gray-200"></div>
                </div>
                <div class="space-y-2">
                    ${groupOrders.map(o => `
                        <div onclick="setAdminView('order-detail', { orderId: ${o.id}, tab: 'order' })" 
                             class="bg-white rounded-xl p-4 shadow-sm flex items-center justify-between hover:bg-gray-50 cursor-pointer transition-colors border border-gray-100">
                            <div class="flex items-center gap-3 min-w-0">
                                <div class="w-2 h-2 rounded-full flex-shrink-0 ${o.status === 'entregado' ? 'bg-emerald-500' : o.status === 'cancelado' ? 'bg-red-500' : o.status === 'enviado' ? 'bg-purple-500' : o.status === 'en_proceso' ? 'bg-amber-500' : 'bg-blue-500'}"></div>
                                <div class="min-w-0">
                                    <span class="text-[11px] font-black uppercase">#${o.order_number}</span>
                                    <p class="text-[9px] font-bold text-gray-400">${(o.order_items || []).length} producto(s)</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-3">
                                <span class="px-2 py-1 rounded-lg text-[8px] font-black uppercase ${statusColors[o.status] || 'bg-gray-100'}">${statusLabels[o.status] || o.status}</span>
                                <span class="text-xs font-black">BOB ${Number(o.total).toFixed(2)}</span>
                                <i class="fa-solid fa-chevron-right text-gray-300 text-xs"></i>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    return html;
}

// =============================================
// VISTA: NOTIFICACIONES (con OTP)
// =============================================
function renderNotificationsView(container) {
    container.innerHTML = `
        <h2 class="text-2xl md:text-4xl font-black uppercase tracking-tighter mb-8 md:mb-12">Notificaciones</h2>
        <div class="bg-white rounded-[2rem] md:rounded-[3rem] p-6 md:p-12 shadow-sm mb-8">
            <h3 class="text-lg md:text-xl font-black uppercase tracking-tighter mb-3 md:mb-4">Correos de Administradores</h3>
            <p class="text-[10px] md:text-xs font-bold text-gray-400 mb-6 md:mb-8 max-w-md">Añade las direcciones de correo electrónico que recibirán notificaciones inmediatas cada vez que un cliente confirme un nuevo pedido. Se verificará con un código OTP.</p>
            
            <!-- Formulario OTP -->
            <div id="otp-form-container">
                ${renderOtpForm()}
            </div>
            
            <!-- Lista de correos existentes -->
            <div class="space-y-3 md:space-y-4 mt-6 md:mt-8">
                ${adminState.adminEmails.length === 0 ? '<p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center py-6">No hay correos registrados.</p>' : adminState.adminEmails.map(e => `
                    <div class="flex justify-between items-center bg-gray-50 p-4 md:p-6 rounded-2xl">
                        <div class="flex items-center gap-3 md:gap-4 min-w-0">
                            <div class="w-9 h-9 md:w-10 md:h-10 bg-white rounded-full flex items-center justify-center shadow-sm flex-shrink-0">
                                <i class="fa-regular fa-envelope text-gray-500 text-sm"></i>
                            </div>
                            <span class="text-[10px] md:text-[11px] font-black lowercase tracking-wider text-gray-700 truncate">${e.email}</span>
                        </div>
                        <button onclick="deleteAdminEmail(${e.id}, '${e.email.replace(/'/g, "\\'")}')" class="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-full hover:bg-red-100 hover:text-red-500 text-gray-300 transition-colors cursor-pointer bg-transparent border-none flex-shrink-0">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderOtpForm() {
    if (adminState.otpStep === 'sending') {
        return `
            <div class="flex items-center justify-center gap-3 py-6">
                <i class="fa-solid fa-circle-notch animate-spin text-lg"></i>
                <span class="text-[10px] font-black uppercase tracking-widest">Enviando código...</span>
            </div>
        `;
    }
    
    if (adminState.otpStep === 'code') {
        return `
            <div class="bg-gray-50 p-5 md:p-6 rounded-2xl border-2 border-dashed border-gray-200 animate-fade">
                <p class="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Verificando:</p>
                <p class="text-xs font-bold text-black mb-4">${adminState.otpPendingEmail}</p>
                <p class="text-[10px] text-gray-500 font-bold mb-4">Hemos enviado un código de 6 dígitos a este correo. Ábrelo, copia el código y pégalo aquí:</p>
                <div class="flex flex-col sm:flex-row gap-3">
                    <input type="text" id="otp-code-input" placeholder="Código de 6 dígitos" maxlength="6" 
                           class="flex-1 p-4 md:p-5 bg-white rounded-2xl outline-none text-center text-xl md:text-2xl font-black tracking-[0.5em] border-2 border-transparent focus:border-black transition-all" 
                           style="font-family: monospace;">
                    <button onclick="verifyOtp()" class="bg-black text-white px-8 py-4 md:py-0 rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-gray-900 active:scale-95 transition-all cursor-pointer">
                        Verificar
                    </button>
                </div>
                <div class="flex gap-4 mt-4">
                    <button onclick="cancelOtp()" class="text-[10px] font-bold text-gray-400 hover:text-black transition-colors cursor-pointer bg-transparent border-none">
                        <i class="fa-solid fa-arrow-left mr-1"></i> Cancelar
                    </button>
                    <button onclick="resendOtp()" class="text-[10px] font-bold text-blue-500 hover:text-blue-700 transition-colors cursor-pointer bg-transparent border-none">
                        <i class="fa-solid fa-rotate-right mr-1"></i> Reenviar código
                    </button>
                </div>
                <p id="otp-error" class="text-[10px] text-red-500 font-bold mt-3 hidden"></p>
            </div>
        `;
    }
    
    // Estado por defecto: pedir email
    return `
        <div class="flex flex-col sm:flex-row gap-3 md:gap-4">
            <input type="email" id="admin-email-input" placeholder="ejemplo@correo.com" 
                   class="flex-1 p-4 md:p-5 bg-gray-50 rounded-2xl outline-none text-[10px] font-bold uppercase border-2 border-transparent focus:border-black transition-all">
            <button onclick="sendOtp()" class="bg-black text-white px-8 md:px-10 py-3 md:py-0 rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-gray-900 active:scale-95 transition-all cursor-pointer">
                <i class="fa-solid fa-paper-plane mr-2"></i>Enviar Código
            </button>
        </div>
        <p id="otp-error" class="text-[10px] text-red-500 font-bold mt-3 hidden"></p>
    `;
}

window.sendOtp = async () => {
    const emailInput = document.getElementById('admin-email-input');
    const email = emailInput?.value.trim();
    if (!email || !email.includes('@')) {
        showOtpError('Introduce un correo electrónico válido.');
        return;
    }
    
    adminState.otpPendingEmail = email;
    adminState.otpStep = 'sending';
    document.getElementById('otp-form-container').innerHTML = renderOtpForm();
    
    try {
        const res = await fetch('/api/admin/emails/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        
        if (res.ok) {
            adminState.otpStep = 'code';
            showAdminToast('Código enviado al correo');
        } else {
            adminState.otpStep = 'email';
            setTimeout(() => showOtpError(data.error || 'Error al enviar el código'), 100);
        }
    } catch (err) {
        adminState.otpStep = 'email';
        setTimeout(() => showOtpError('Error de conexión'), 100);
    }
    
    document.getElementById('otp-form-container').innerHTML = renderOtpForm();
};

window.verifyOtp = async () => {
    const codeInput = document.getElementById('otp-code-input');
    const code = codeInput?.value.trim();
    if (!code || code.length < 6) {
        showOtpError('Introduce el código completo de 6 dígitos.');
        return;
    }
    
    try {
        const res = await fetch('/api/admin/emails/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: adminState.otpPendingEmail.trim(), code })
        });
        const data = await res.json();
        
        if (res.ok) {
            adminState.otpStep = 'email';
            adminState.otpPendingEmail = null;
            showAdminToast('¡Correo verificado y agregado!');
            loadAdminData();
        } else {
            showOtpError(data.error || 'Código incorrecto.');
        }
    } catch (err) {
        showOtpError('Error de conexión.');
    }
};

window.cancelOtp = () => {
    adminState.otpStep = 'email';
    adminState.otpPendingEmail = null;
    document.getElementById('otp-form-container').innerHTML = renderOtpForm();
};

window.resendOtp = async () => {
    adminState.otpStep = 'sending';
    document.getElementById('otp-form-container').innerHTML = renderOtpForm();
    
    try {
        const res = await fetch('/api/admin/emails/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: adminState.otpPendingEmail })
        });
        
        if (res.ok) {
            adminState.otpStep = 'code';
            showAdminToast('Código reenviado');
        } else {
            adminState.otpStep = 'code';
        }
    } catch (err) {
        adminState.otpStep = 'code';
    }
    
    document.getElementById('otp-form-container').innerHTML = renderOtpForm();
};

function showOtpError(msg) {
    const el = document.getElementById('otp-error');
    if (el) {
        el.innerText = msg;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 5000);
    }
}

window.deleteAdminEmail = async (id, email) => {
    if (confirm(`¿Eliminar ${email} de los administradores?`)) {
        await fetch(`/api/admin/emails/${id}`, { method: 'DELETE' });
        loadAdminData();
        showAdminToast('Correo eliminado');
    }
};

// =============================================
// ACTUALIZAR ESTADO DE PEDIDO
// =============================================
async function updateOrderStatus(orderId, status) {
    try {
        const res = await fetch(`/api/admin/orders/${orderId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (res.ok) {
            showAdminToast('Estado Actualizado');
            await loadAdminData();
        } else {
            alert("Error al actualizar el estado");
        }
    } catch (err) {
        console.error("Error actualizando estado:", err);
        alert("Error de conexión");
    }
}

function logoutAdmin() {
    localStorage.removeItem('emma_admin_session');
    location.reload();
}

// =============================================
// VISTA: ENTREGA (Precio, Transportadora, Zonas)
// =============================================
const BOLIVIA_DEPARTMENTS = [
    'Beni', 'Chuquisaca', 'Cochabamba', 'La Paz',
    'Oruro', 'Pando', 'Potosí', 'Santa Cruz', 'Tarija'
];

async function renderDeliveryView(container) {
    container.innerHTML = `
        <h2 class="text-2xl md:text-4xl font-black uppercase tracking-tighter mb-8 md:mb-12 animate-fade">Configuración de Entrega</h2>
        <div id="delivery-loading" class="flex items-center justify-center py-20">
            <i class="fa-solid fa-circle-notch animate-spin text-3xl text-gray-300"></i>
        </div>
    `;
    try {
        const [configRes, optionsRes] = await Promise.all([
            fetch('/api/admin/store-config'),
            fetch('/api/admin/shipping-options')
        ]);
        const config = await configRes.json();
        const options = await optionsRes.json();
        renderDeliveryContent(container, config, options);
    } catch (err) {
        container.innerHTML += `<p class="text-red-500 text-center">Error cargando configuración</p>`;
    }
}

async function refreshDeliveryDataSilently() {
    try {
        const [configRes, optionsRes] = await Promise.all([
            fetch('/api/admin/store-config'),
            fetch('/api/admin/shipping-options')
        ]);
        const config = await configRes.json();
        const options = await optionsRes.json();
        const container = document.getElementById('admin-main');
        if (container) {
            renderDeliveryContent(container, config, options);
        }
    } catch (err) {
        console.error("Error al recargar datos de entrega silenciosamente", err);
    }
}

function renderDeliveryContent(container, config, options) {
    const zones = config.delivery_zones || ['Cochabamba'];
    const lastUpdate = config.updated_at ? new Date(config.updated_at).toLocaleString('es-BO', { timeZone: 'America/La_Paz' }) : 'Nunca';

    container.innerHTML = `
        <div class="flex items-center justify-between mb-8 md:mb-12 animate-fade">
            <div>
                <h2 class="text-2xl md:text-4xl font-black uppercase tracking-tighter">Configuración de Entrega</h2>
                <p class="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1">Última actualización: ${lastUpdate}</p>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 animate-fade mb-6 md:mb-8">

            <!-- MÓDULO: Opciones de Envío (CRUD) -->
            <div class="bg-white p-6 md:p-10 rounded-[2rem] md:rounded-[3rem] shadow-sm flex flex-col">
                <div class="flex items-center justify-between mb-6">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 bg-black text-white rounded-2xl flex items-center justify-center flex-shrink-0">
                            <i class="fa-solid fa-truck-fast text-sm"></i>
                        </div>
                        <div>
                            <h3 class="text-sm font-black uppercase tracking-tighter">Métodos de Envío</h3>
                            <p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Para zonas con sucursal</p>
                        </div>
                    </div>
                    <button onclick="openShippingOptionModal()" class="w-8 h-8 bg-gray-100 hover:bg-black hover:text-white rounded-xl flex items-center justify-center transition-colors">
                        <i class="fa-solid fa-plus text-xs"></i>
                    </button>
                </div>

                <div class="space-y-3 flex-1 overflow-y-auto max-h-[400px] pr-2 custom-scrollbar">
                    ${options.map(opt => `
                        <div class="border border-gray-100 p-4 rounded-2xl relative group ${opt.is_active ? 'bg-white' : 'bg-gray-50 opacity-60'}">
                            <div class="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onclick="openShippingOptionModal(${opt.id})" class="w-6 h-6 rounded bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-600 flex items-center justify-center text-[10px]">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                                <button onclick="deleteShippingOption(${opt.id})" class="w-6 h-6 rounded bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-600 flex items-center justify-center text-[10px]">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </div>
                            <h4 class="text-xs font-black uppercase tracking-wide text-black pr-16">${opt.title}</h4>
                            <p class="text-[10px] text-gray-400 font-bold mt-1 line-clamp-2">${opt.description || 'Sin descripción'}</p>
                            <div class="flex justify-between items-end mt-3">
                                <span class="text-[9px] font-black uppercase tracking-widest px-2 py-1 bg-gray-100 rounded-lg text-gray-500">${opt.type}</span>
                                <span class="text-xs font-black ${opt.price == 0 ? 'text-green-600' : 'text-black'}">${opt.price == 0 ? 'GRATIS' : `Bs. ${opt.price}`}</span>
                            </div>
                        </div>
                    `).join('')}
                    ${options.length === 0 ? '<p class="text-center text-[10px] text-gray-400 font-bold py-4">No hay métodos configurados</p>' : ''}
                </div>
            </div>

            <!-- MÓDULO: Zonas y Transportadora -->
            <div class="space-y-6 md:space-y-8">
                
                <!-- Zonas de Cobertura -->
                <div class="bg-white p-6 md:p-10 rounded-[2rem] md:rounded-[3rem] shadow-sm">
                    <div class="flex items-center gap-3 mb-6">
                        <div class="w-10 h-10 bg-black text-white rounded-2xl flex items-center justify-center flex-shrink-0">
                            <i class="fa-solid fa-map-location-dot text-sm"></i>
                        </div>
                        <div>
                            <h3 class="text-sm font-black uppercase tracking-tighter">Zonas con Sucursales</h3>
                            <p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Habilita delivery y contra entrega</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-3 gap-2 mb-6" id="delivery-zones-grid">
                        ${BOLIVIA_DEPARTMENTS.map(dept => {
                            const isChecked = zones.includes(dept);
                            return `
                            <div onclick="toggleDeliveryZone(this, '${dept}')"
                                 class="zone-chip cursor-pointer py-3 px-2 rounded-2xl border-2 text-center transition-all select-none
                                        ${isChecked ? 'bg-black text-white border-black' : 'bg-gray-50 text-gray-500 border-gray-100 hover:border-gray-300'}"
                                 data-zone="${dept}" data-active="${isChecked}">
                                <p class="text-[9px] font-black uppercase tracking-wide">${dept}</p>
                                <i class="fa-solid ${isChecked ? 'fa-check' : 'fa-plus'} text-[8px] mt-1"></i>
                            </div>`;
                        }).join('')}
                    </div>
                    <button onclick="saveDeliveryZones()" class="w-full py-4 bg-black text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-900 active:scale-95 transition-all cursor-pointer border-none shadow-xl">
                        Guardar Zonas
                    </button>
                </div>

                <!-- Cargo Transportadora (Fuera de zona) -->
                <div class="bg-white p-6 md:p-10 rounded-[2rem] md:rounded-[3rem] shadow-sm">
                    <label class="text-[9px] font-black uppercase tracking-widest text-gray-400 block mb-2">
                        <i class="fa-solid fa-truck mr-1 text-orange-500"></i>
                        Cargo Base Transportadora
                    </label>
                    <div class="flex items-center gap-3">
                        <div class="flex items-center gap-2 flex-1 bg-orange-50 border-2 border-transparent focus-within:border-orange-400 rounded-2xl px-4 py-3 transition-all">
                            <span class="text-xs font-black text-orange-400">Bs.</span>
                            <input type="number" id="delivery-carrier-cost" value="${config.carrier_cost}" min="0" step="0.5"
                                class="flex-1 bg-transparent text-sm font-black outline-none text-black">
                        </div>
                        <button onclick="saveCarrierCost()" class="px-6 py-3 bg-orange-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-600 active:scale-95 transition-all cursor-pointer border-none">
                            Guardar
                        </button>
                    </div>
                    <p class="text-[9px] text-gray-400 font-bold mt-2">Referencia de costo para envíos fuera de zona. (Se informa internamente el costo final).</p>
                </div>
                
            </div>
        </div>

        <!-- Modal Opciones de Envío -->
        <div id="shipping-opt-modal" class="fixed inset-0 bg-black/50 z-[200] hidden items-center justify-center p-4">
            <div class="bg-white w-full max-w-md rounded-[2rem] p-8 animate-fade relative">
                <button onclick="closeShippingOptionModal()" class="absolute top-6 right-6 text-gray-400 hover:text-black">
                    <i class="fa-solid fa-xmark text-xl"></i>
                </button>
                <h3 class="text-lg font-black uppercase tracking-tighter mb-6" id="sh-modal-title">Nueva Opción</h3>
                
                <input type="hidden" id="sh-id" value="">
                
                <div class="space-y-4">
                    <div>
                        <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Título</label>
                        <input type="text" id="sh-title" placeholder="Ej: Envío Express" class="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-xs font-black focus:border-black outline-none">
                    </div>
                    <div>
                        <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Descripción</label>
                        <textarea id="sh-desc" placeholder="Ej: Llega en 24 horas..." rows="2" class="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-xs font-medium focus:border-black outline-none"></textarea>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Precio (Bs.)</label>
                            <input type="number" id="sh-price" value="0" min="0" step="0.5" class="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-xs font-black focus:border-black outline-none">
                        </div>
                        <div>
                            <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Tipo</label>
                            <select id="sh-type" class="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-xs font-black focus:border-black outline-none cursor-pointer">
                                <option value="domicilio">Domicilio</option>
                                <option value="encomienda">Encomienda</option>
                            </select>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Orden (Prioridad)</label>
                            <input type="number" id="sh-order" value="0" min="0" class="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-xs font-black focus:border-black outline-none">
                        </div>
                        <div class="flex items-center gap-2 mt-6">
                            <input type="checkbox" id="sh-active" checked class="w-4 h-4 accent-black cursor-pointer">
                            <label class="text-[10px] font-black uppercase tracking-widest cursor-pointer select-none" for="sh-active">Activo</label>
                        </div>
                    </div>
                    <button onclick="saveShippingOption()" class="w-full py-4 mt-2 bg-black text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-900 transition-all">
                        Guardar Opción
                    </button>
                </div>
            </div>
        </div>

        <!-- Modal Confirmación Eliminar -->
        <div id="delete-sh-modal" class="fixed inset-0 bg-black/50 z-[200] hidden items-center justify-center p-4">
            <div class="bg-white w-full max-w-sm rounded-[2rem] p-8 text-center animate-fade">
                <div class="w-16 h-16 bg-red-100 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <i class="fa-solid fa-triangle-exclamation text-2xl"></i>
                </div>
                <h3 class="text-lg font-black uppercase tracking-tighter mb-2">¿Eliminar Opción?</h3>
                <p class="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-8">Esta acción no se puede deshacer.</p>
                <input type="hidden" id="delete-sh-id" value="">
                <div class="grid grid-cols-2 gap-3">
                    <button onclick="closeDeleteShippingModal()" class="w-full py-4 bg-gray-100 text-gray-500 hover:text-black hover:bg-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
                        Cancelar
                    </button>
                    <button onclick="executeDeleteShippingOption()" class="w-full py-4 bg-red-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition-all">
                        Sí, Eliminar
                    </button>
                </div>
            </div>
        </div>
    `;

    window.adminOptionsCache = options; // Cache para edición
}

window.openShippingOptionModal = (id = null) => {
    document.getElementById('shipping-opt-modal').classList.remove('hidden');
    document.getElementById('shipping-opt-modal').classList.add('flex');
    const modalTitle = document.getElementById('sh-modal-title');
    
    if (id) {
        modalTitle.innerText = "Editar Opción";
        const opt = window.adminOptionsCache.find(o => o.id === id);
        if(opt) {
            document.getElementById('sh-id').value = opt.id;
            document.getElementById('sh-title').value = opt.title;
            document.getElementById('sh-desc').value = opt.description;
            document.getElementById('sh-price').value = opt.price;
            document.getElementById('sh-type').value = opt.type;
            document.getElementById('sh-order').value = opt.sort_order;
            document.getElementById('sh-active').checked = opt.is_active == 1;
        }
    } else {
        modalTitle.innerText = "Nueva Opción";
        document.getElementById('sh-id').value = '';
        document.getElementById('sh-title').value = '';
        document.getElementById('sh-desc').value = '';
        document.getElementById('sh-price').value = '0';
        document.getElementById('sh-type').value = 'domicilio';
        document.getElementById('sh-order').value = '0';
        document.getElementById('sh-active').checked = true;
    }
};

window.closeShippingOptionModal = () => {
    document.getElementById('shipping-opt-modal').classList.add('hidden');
    document.getElementById('shipping-opt-modal').classList.remove('flex');
};

window.saveShippingOption = () => {
    const id = document.getElementById('sh-id').value;
    const data = {
        title: document.getElementById('sh-title').value.trim(),
        description: document.getElementById('sh-desc').value.trim(),
        price: parseFloat(document.getElementById('sh-price').value) || 0,
        type: document.getElementById('sh-type').value,
        sort_order: parseInt(document.getElementById('sh-order').value) || 0,
        is_active: document.getElementById('sh-active').checked ? 1 : 0
    };
    
    if (!data.title) return alert("El título es obligatorio");
    
    const url = id ? `/api/admin/shipping-options/${id}` : '/api/admin/shipping-options';
    const method = id ? 'PUT' : 'POST';
    
    sendWithProgress(url, method, data, () => {
        closeShippingOptionModal();
        showAdminToast("Opción guardada con éxito");
        refreshDeliveryDataSilently();
    });
};

window.deleteShippingOption = (id) => {
    document.getElementById('delete-sh-id').value = id;
    document.getElementById('delete-sh-modal').classList.remove('hidden');
    document.getElementById('delete-sh-modal').classList.add('flex');
};

window.closeDeleteShippingModal = () => {
    document.getElementById('delete-sh-modal').classList.add('hidden');
    document.getElementById('delete-sh-modal').classList.remove('flex');
};

window.executeDeleteShippingOption = () => {
    const id = document.getElementById('delete-sh-id').value;
    sendWithProgress(`/api/admin/shipping-options/${id}`, 'DELETE', {}, () => {
        closeDeleteShippingModal();
        showAdminToast("Opción eliminada con éxito");
        refreshDeliveryDataSilently();
    });
};

window.toggleDeliveryZone = (el, zone) => {
    const isActive = el.getAttribute('data-active') === 'true';
    el.setAttribute('data-active', !isActive);
    if (!isActive) {
        el.classList.add('bg-black', 'text-white', 'border-black');
        el.classList.remove('bg-gray-50', 'text-gray-500', 'border-gray-100');
        el.querySelector('i').className = 'fa-solid fa-check text-[8px] mt-1';
    } else {
        el.classList.remove('bg-black', 'text-white', 'border-black');
        el.classList.add('bg-gray-50', 'text-gray-500', 'border-gray-100');
        el.querySelector('i').className = 'fa-solid fa-plus text-[8px] mt-1';
    }
};

window.saveCarrierCost = () => {
    const cost = parseFloat(document.getElementById('delivery-carrier-cost').value);
    if (isNaN(cost) || cost < 0) return showAdminToast('Precio inválido');
    
    sendWithProgress('/api/admin/store-config', 'PUT', { carrier_cost: cost }, () => {
        showAdminToast('✓ Cargo transportadora guardado: Bs. ' + cost.toFixed(2));
        refreshDeliveryDataSilently();
    });
};

window.saveDeliveryZones = () => {
    const chips = document.querySelectorAll('#delivery-zones-grid .zone-chip');
    const zones = [];
    chips.forEach(chip => {
        if (chip.getAttribute('data-active') === 'true') {
            zones.push(chip.getAttribute('data-zone'));
        }
    });
    
    sendWithProgress('/api/admin/store-config', 'PUT', { delivery_zones: zones }, () => {
        showAdminToast(`✓ ${zones.length} zona(s) guardada(s)`);
        refreshDeliveryDataSilently();
    });
};
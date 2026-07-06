-- =============================================
-- EMMA STORE — SUPABASE SCHEMA (PostgreSQL)
-- Solo para: Usuarios, Direcciones, Pedidos
-- Productos/Categorías/Contactos → MySQL/Aiven
-- =============================================

-- =============================================
-- 1. TABLA: profiles
-- Extiende auth.users de Supabase con datos extra
-- =============================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    avatar_url TEXT,
    phone TEXT,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsquedas por email
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- =============================================
-- 2. TABLA: addresses
-- Direcciones múltiples por usuario
-- =============================================
CREATE TABLE IF NOT EXISTS addresses (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    label TEXT DEFAULT 'Casa',           -- Ej: "Casa", "Trabajo", "Mamá"
    street TEXT NOT NULL,                -- Calle, avenida, Nro
    apartment TEXT,                      -- Piso, depto, suite (opcional)
    city TEXT NOT NULL,
    department TEXT DEFAULT 'Cochabamba', -- Departamento de Bolivia
    country TEXT DEFAULT 'Bolivia',
    maps_link TEXT,                      -- Enlace de Google Maps (opcional)
    door_description TEXT,               -- Descripción de fachada/puerta (opcional)
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);

-- =============================================
-- 3. TABLA: orders
-- Historial de pedidos procesados
-- =============================================
CREATE TABLE IF NOT EXISTS orders (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    order_number TEXT NOT NULL,                      -- Número visible (#1234 o EMMA-XXXXXX)
    subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
    shipping_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
    total DECIMAL(10,2) NOT NULL DEFAULT 0,
    shipping_method TEXT DEFAULT 'express',          -- 'express' | 'free'
    status TEXT DEFAULT 'confirmado',                -- 'confirmado' | 'en_proceso' | 'enviado' | 'entregado' | 'cancelado'
    -- Datos de contacto al momento del pedido
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    -- Dirección de envío al momento del pedido (snapshot)
    shipping_address TEXT,
    shipping_city TEXT,
    shipping_department TEXT,
    shipping_maps_link TEXT,
    shipping_door_desc TEXT,
    shipping_apartment TEXT,
    -- Vendedor asignado
    seller_name TEXT,
    seller_number TEXT,
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

-- =============================================
-- 4. TABLA: order_items
-- Items individuales de cada pedido
-- =============================================
CREATE TABLE IF NOT EXISTS order_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INT,                        -- ID del producto en MySQL (referencia cruzada)
    product_name TEXT NOT NULL,
    product_image TEXT,                     -- URL de la primera imagen
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- =============================================
-- 5. ROW LEVEL SECURITY (RLS)
-- =============================================

-- Habilitar RLS en todas las tablas
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- ----- PROFILES -----
-- Cualquiera puede ver perfiles (para mostrar nombre en reviews, etc.)
CREATE POLICY "Profiles are viewable by everyone"
    ON profiles FOR SELECT
    USING (true);

-- Solo el dueño puede actualizar su perfil
CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Solo el dueño puede insertar su perfil (o el trigger)
CREATE POLICY "Users can insert own profile"
    ON profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- ----- ADDRESSES -----
-- Solo el dueño puede ver sus direcciones
CREATE POLICY "Users can view own addresses"
    ON addresses FOR SELECT
    USING (auth.uid() = user_id);

-- Solo el dueño puede crear direcciones
CREATE POLICY "Users can insert own addresses"
    ON addresses FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Solo el dueño puede actualizar sus direcciones
CREATE POLICY "Users can update own addresses"
    ON addresses FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Solo el dueño puede eliminar sus direcciones
CREATE POLICY "Users can delete own addresses"
    ON addresses FOR DELETE
    USING (auth.uid() = user_id);

-- ----- ORDERS -----
-- Solo el dueño puede ver sus pedidos
CREATE POLICY "Users can view own orders"
    ON orders FOR SELECT
    USING (auth.uid() = user_id);

-- Solo el dueño puede crear pedidos
CREATE POLICY "Users can insert own orders"
    ON orders FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Política para que el service_role pueda ver todos los pedidos (admin panel)
CREATE POLICY "Service role can view all orders"
    ON orders FOR SELECT
    USING (auth.role() = 'service_role');

-- Política para que el service_role pueda actualizar pedidos (admin panel)
CREATE POLICY "Service role can update all orders"
    ON orders FOR UPDATE
    USING (auth.role() = 'service_role');

-- ----- ORDER_ITEMS -----
-- Los items son visibles si el usuario es dueño del pedido
CREATE POLICY "Users can view own order items"
    ON order_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM orders
            WHERE orders.id = order_items.order_id
            AND orders.user_id = auth.uid()
        )
    );

-- Solo el dueño del pedido puede insertar items
CREATE POLICY "Users can insert own order items"
    ON order_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM orders
            WHERE orders.id = order_items.order_id
            AND orders.user_id = auth.uid()
        )
    );

-- Service role puede ver todos los order_items (admin panel)
CREATE POLICY "Service role can view all order items"
    ON order_items FOR SELECT
    USING (auth.role() = 'service_role');

-- Service role puede ver todos los perfiles (admin panel)
CREATE POLICY "Service role can view all profiles"
    ON profiles FOR SELECT
    USING (auth.role() = 'service_role');

-- Service role puede ver todas las addresses (admin panel)
CREATE POLICY "Service role can view all addresses"
    ON addresses FOR SELECT
    USING (auth.role() = 'service_role');

-- =============================================
-- 6. TRIGGER: Auto-crear perfil al registrarse
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', ''),
        COALESCE(NEW.email, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Crear trigger solo si no existe
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- 7. FUNCIÓN: Actualizar updated_at automáticamente
-- =============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar a profiles
DROP TRIGGER IF EXISTS set_profiles_updated_at ON profiles;
CREATE TRIGGER set_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Aplicar a addresses
DROP TRIGGER IF EXISTS set_addresses_updated_at ON addresses;
CREATE TRIGGER set_addresses_updated_at
    BEFORE UPDATE ON addresses
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Aplicar a orders
DROP TRIGGER IF EXISTS set_orders_updated_at ON orders;
CREATE TRIGGER set_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

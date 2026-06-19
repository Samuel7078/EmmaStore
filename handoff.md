# Documento de Entrega (Handoff) - Emma Store

Este documento contiene un resumen detallado de todas las características, rediseños visuales y lógicas de interacción móvil/PC que hemos implementado en la aplicación web de Emma Store.

---

## 1. Sistema SPA, Enrutamiento e Historial de Navegación
- **Navegación sin Recarga (SPA)**: Migramos la navegación tradicional a una arquitectura Single Page Application utilizando un enrutador en `index.js` sincronizado con la URL (`?view=home`, `?view=detail&product=id`, `?view=checkout`).
- **Sincronización del Historial (Atrás/Adelante)**: Implementamos el manejo del historial del navegador mediante `window.history.pushState` y `replaceState`, permitiendo que las acciones físicas de volver atrás mantengan al usuario en el flujo correcto de la aplicación en vez de sacarlo del sitio.
- **Restauración Automática de Scroll**: Al volver a una pantalla anterior (por ejemplo, del detalle al catálogo), la aplicación almacena y restaura automáticamente la posición exacta del scroll (`scrollY`) del usuario.
- **Botones Físicos de Volver**: 
  - Añadimos un botón en el header principal al lado del logo (oculto en home, visible en detalle y checkout).
  - Diseñamos un botón flotante circular translúcido sobre la esquina superior izquierda de la imagen en dispositivos móviles.

---

## 2. Autenticación e Integración estilo Amazon
- **Navbar estilo Amazon**: Rediseñamos el encabezado superior:
  - En la esquina superior derecha se muestra "Hola, Identifícate / Mi Cuenta".
  - Se implementó un menú desplegable (Dropdown) con el botón "Iniciar sesión con Google".
  - En móviles, este menú se presenta en formato Bottom Sheet Drawer.
- **Ventana de Autenticación de Google**: La ventana de inicio de sesión abre un popup independiente y seguro (`google-login.html`) y se comunica mediante `postMessage` para actualizar el estado del usuario localmente al instante.
- **Hook de Compra**: Si un usuario invitado intenta añadir un producto o confirmar su bolsa, se abre un popup persuasivo que solicita conectarse con Google antes de proceder.

---

## 3. Formulario de Pedido (Checkout) estilo Shopify
- **Diseño Responsivo**: Pantalla de checkout dividida en 2 columnas en pantallas grandes (resumen a la derecha, datos a la izquierda) y 1 columna en dispositivos móviles.
- **Autollenado Inteligente**: La información personal del cliente (nombre, apellido y correo) se pre-llena a partir de su cuenta de Google.
- **Caché de Envío Local**: Añadimos un checkbox "Guardar mi información". Al activarse, los datos se guardan de forma encriptada en el caché local (`localStorage`) para agilizar futuras compras.
- **Enlace de Google Maps y Fachada**: Incluye campos dedicados para que el cliente pegue su link de GPS y añada descripciones opcionales de la puerta o fachada de su domicilio.
- **Cálculo de Envío Dinámico**: Opciones de "Envío Gratis (Puntos de Encuentro)" y "Envío Delivery Express (A domicilio: BOB 15.00)" que recalculan el total del pedido en tiempo real.
- **Mensaje estructurado de WhatsApp**: Al finalizar el pedido, la aplicación formatea y abre de manera directa un chat detallado de WhatsApp con el vendedor respectivo, desglosando productos, subtotal, tipo de envío y dirección del cliente.

---

## 4. Buscador con Cajón de Filtros (Filter Drawer)
- **Activador de Filtros**: Añadimos botones con el icono de deslizadores al lado de las barras de búsqueda en PC y móviles.
- **Cajón Estilo Bottom Sheet**: Diseñamos un cajón animado que se desliza desde abajo en móviles y se despliega como un modal centralizado en PC.
- **Interactividad e Inputs**:
  - **Ordenar por**: Selector de fecha (reciente/antiguo) y precio (bajo-alto/alto-bajo).
  - **Acordeón de Precio**: Rango dinámico autocalculado de los productos disponibles. Posee un doble deslizador (double-thumb range slider) con una barra negra central de relleno y dos cajas numéricas sincronizadas en tiempo real.
  - **Botón de Limpiar**: Agregado en el encabezado del cajón para resetear todos los valores a los límites predeterminados del catálogo.
  - **Contador Reactivo**: Muestra en tiempo real la cantidad de productos coincidentes con las opciones marcadas: `Ver resultados (X)` antes de aplicarlos definitivamente.

---

## 5. Diseño Estético y Animaciones del Catálogo
- **Carrusel de Categorías Autogiratorio**: Las píldoras de categorías ubicadas debajo del buscador se desplazan automáticamente de izquierda a derecha. Se agregó un controlador inteligente que detiene la rotación al instante si el usuario pasa el cursor, toca o scrollea manualmente, reanudando la rotación tras 3 segundos de inactividad.
- **Remover Restricciones de Stock**: Se eliminaron los badges de "Agotado" y los botones deshabilitados; todos los productos se inicializan siempre en stock (`inStock: true`).
- **Tarjeta Destacada Ancha**: Diseñamos una tarjeta destacada que ocupa el ancho completo (`col-span-2 lg:col-span-4`) y se inserta de manera dinámica cada 2 filas en la rejilla del catálogo (cada 4 items en móviles, cada 8 en PC). Cuenta con la foto a la izquierda (ancho fijo auto-ajustable `w-28 md:w-44 aspect-[3/4]`) y sus datos, descripción completa y botones a la derecha. Su altura total se ajusta de manera automática al volumen de la descripción.
- **Animaciones Avanzadas (Scroll Reveal & Explode)**:
  - **Entrada (Scroll Down)**: Las tarjetas del catálogo se deslizan hacia arriba y ganan opacidad de manera progresiva al entrar a la pantalla.
  - **Explosión (Scroll Up)**: Si las tarjetas del catálogo salen de la pantalla por el extremo inferior (cuando el usuario vuelve a subir), estas se desvanecen expandiéndose a un tamaño de `scale(1.15)` y rotando levemente.
  - **Fading de Imágenes**: Las fotos se cargan con `opacity-0` y cambian suavemente a `opacity-100` una vez descargadas en caché, evitando saltos bruscos.

---

## 6. Base de Datos Híbrida (Aiven MySQL + Supabase Postgres)
- **Migración Parcial de Datos Sensibles**: Separamos la lógica de negocio. Los productos, categorías, stories y contactos se mantienen en **Aiven MySQL**. Se integró **Supabase (PostgreSQL)** exclusivamente para gestionar perfiles de usuario, direcciones múltiples y el historial de pedidos de manera segura.
- **Variables de Entorno y Seguridad**: 
  - Configuramos las variables en `.env` (oculto) y creamos `.env.example`.
  - El sistema extrae dinámicamente las credenciales seguras de Supabase (`SUPABASE_URL` y `SUPABASE_ANON_KEY`) desde el backend a través de la ruta protegida `/api/config`, previniendo exposición directa en el código fuente.
  - Corrección del soporte para la versión gratuita de Supabase configurando un `Transaction Pooler` (puerto 6543) compatible con IPv4 para herramientas de terceros.

---

## 7. Autenticación Real con Google (Supabase Auth)
- **Eliminación del Mock**: Se descartó la pantalla simulada (`google-login.html`) a favor del SDK oficial `@supabase/supabase-js`.
- **Integración Segura en el Frontend y Backend**: El inicio de sesión se realiza mediante `supabase.auth.signInWithOAuth`. El servidor (`api/index.js`) puede leer las sesiones activas en caso de necesitar seguridad extrema en endpoints cerrados.
- **Sincronización de Perfiles (Postgres Triggers)**: Se diseñó un script (`schema.sql`) que contiene la creación de tablas y un `Trigger` que automáticamente genera una fila en la tabla `profiles` cada vez que un usuario nuevo hace login con Google.
- **Resolución de Bugs Críticos**: Solucionamos un error severo en Javascript (`Cannot read properties of null (reading 'auth')`) que ocurría porque el "Listener" del estado de sesión intentaba ejecutarse antes de que el cliente de Supabase terminara de configurarse dinámicamente. Al encapsularlo en la promesa principal, estabilizamos por completo el tiempo de carga.

---

## 8. Gestión del Perfil de Usuario y Direcciones
- **Multi-Direcciones**: Desde su cuenta, el cliente puede guardar múltiples direcciones para sus envíos.
- **Datos Precisos para Entregas**: El formulario de direcciones incluye campos clave como "Departamento (Ciudad)", "Calle", "Piso/Nro", "Descripción de Fachada", y un enlace opcional directamente a **Google Maps**.
- **Dirección Predeterminada**: Los usuarios pueden elegir una dirección como favorita. Esta dirección se autocompleta instantáneamente al abrir la ventana de Checkout.
- **Manejo de Fallos (UX)**: Se introdujo un bloque de seguridad visual (`finally`) que previene que la barra de carga de la página principal se quede atascada indefinidamente en la pantalla en caso de que ocurran errores de red o caídas temporales del servidor.

---

## 9. Historial de Compras en la Nube
- **Almacenamiento de Pedidos**: Al finalizar la compra en el Checkout, el sistema realiza un `POST` al backend (`/api/user/orders`) que inyecta la información del carrito, el total y el vendedor elegido en las tablas relacionales `orders` y `order_items` de Supabase.
- **Panel "Mis Pedidos"**: El usuario puede acceder a una vista dedicada dentro de su cajón lateral donde puede visualizar sus compras pasadas, los productos comprados, el desglose de precios y el "Estado" en tiempo real del paquete (Confirmado, En proceso, Enviado, Entregado, etc.).

---

## 10. Panel de Administración (Gestión de Supabase)
- **Nuevos Paneles para Usuarios y Pedidos**: Se extendió la interfaz de `admin.html` para incorporar datos provenientes de la base de datos de PostgreSQL.
- **Lista de Usuarios**: Permite al administrador visualizar quién se ha registrado, con sus fotos de perfil de Google, nombres, correos y fecha de ingreso.
- **Actualización de Estado de Paquetes**: El administrador visualiza en tiempo real los pedidos de los clientes y cuenta con un menú desplegable para cambiar manualmente el estado logístico del paquete, reflejándose inmediatamente en el panel del cliente.

---

## 11. Flujo de Modo Visitante (Guest Checkout)
- **Compra sin Cuenta**: Implementamos un botón "Continuar como visitante" en el popup de inicio de sesión, permitiendo a los clientes saltarse la creación de cuenta en Google.
- **Guardado Híbrido Anónimo**: Modificamos el esquema de Supabase:
  - Eliminamos la restricción `NOT NULL` de la columna `user_id` para permitir el registro de ventas anónimas.
  - Cambiamos el tipo de `order_number` de `INT` a `TEXT` para soportar códigos alfanuméricos como "EMMA-XYZ".
- **Integración Transparente**: El pedido como visitante se guarda en la misma base de datos, por lo que aparece en el Panel de Administración de manera idéntica a un usuario registrado.
- **Políticas de Privacidad Obligatorias**: Añadimos un checkbox de aceptación de políticas obligatorio en el modal de login. Se desarrolló una ventana modal con las políticas detallando el manejo local/DB de los datos y su uso por repartidores.

---

## 12. Sistema de Notificaciones Automáticas (Correos Electrónicos)
- **Integración SendPulse**: Al confirmarse un pedido (sea registrado o visitante), el servidor (`/api/public/orders`) extrae el correo proporcionado por el cliente y le envía su recibo de compra detallado usando la API REST nativa de SendPulse.
- **Integración Gmail (Nodemailer) para Admins**: De forma paralela, el sistema lee la lista de correos de la tabla `admin_emails` y les despacha una notificación en tiempo real con la alerta de "Nuevo Pedido Recibido", para que ventas se ponga en contacto inmediato con el cliente.

---

## 13. Errores Conocidos y Estado Actual (Bug Local Vercel)
Actualmente, el sistema experimenta un fallo **exclusivamente en el entorno de desarrollo local** (Windows + Vercel CLI):
- **Error**: `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`
- **Causa**: Es un *bug* documentado de la librería interna de NodeJS (`libuv`) en el sistema operativo Windows cuando se combinan múltiples procesos asíncronos de resolución DNS y envío por SMTP utilizando `nodemailer` a través del emulador local `vercel dev`.
- **Efecto**: El servidor local "crashea" inesperadamente después o durante el envío de correos, obligando a reiniciar el comando en la terminal.
- **Solución Real**: Este error **no afecta el entorno de producción**. Una vez desplegado el código a los servidores reales de Vercel en la nube (Linux/Serverless), las peticiones UDP asíncronas de Nodemailer se resolverán perfectamente sin colapsos. Por ahora, a nivel local, simplemente se debe reiniciar el comando (`Ctrl+C` y luego `vercel dev`) en la terminal si esto sucede.

---

## 14. Caché de Términos y Condiciones
- **Mejora de UX**: Implementamos un registro en `localStorage` (`emma_tc_accepted`) que recuerda si el usuario ya aceptó los términos y condiciones de compra y privacidad. Esto evita que la casilla de verificación sea mostrada repetitivamente en futuras compras, agilizando el checkout de los usuarios (tanto visitantes como registrados).

---
## 15. SEO Dinámico y Resolución de Dominios en Google Search Console
- **Sitemap Dinámico de Tiempo de Ejecución**: Rediseñamos el sistema para servir el sitemap dinámicamente en la ruta `/sitemap.xml` mediante `/api/index.js`. Esto permite extraer en tiempo real las categorías y productos de la base de datos y generar al instante el XML con etiquetas de última modificación `<lastmod>` válidas.
- **Resolución Automática de Dominios**: El endpoint dinámico resuelve el dominio base leyendo los encabezados del host (`req.headers.host`), garantizando que las URLs del sitemap (`<loc>`) siempre coincidan con el dominio en el que Google realiza la consulta (ej. `www.emmastore.net`), solucionando el error de "dominio cruzado no permitido" en Google Search Console.
- **Robots.txt Dinámico**: Reemplazamos el robots.txt estático por una ruta dinámica que apunta dinámicamente a la URL absoluta del sitemap basada en el dominio consultado.
- **Limpieza de Conflictos en Vercel**: Eliminamos por completo los archivos estáticos `public/sitemap.xml` y `public/robots.txt` del repositorio, y desactivamos la compilación estática en el `"vercel-build"` de `package.json`, asegurando que Vercel no sirva archivos estáticos obsoletos y deje pasar las solicitudes a los endpoints dinámicos.
- **Mejora del Script Estático**: Refactorizamos `scripts/generate-sitemap.js` para normalizar el URL base (limpieza de barras diagonales para evitar problemas como `//?product=`) e incluir el tag `<lastmod>` para ejecuciones y auditorías locales.

---

## 16. Panel de Cuotas y Control de Correos (Settings UI)
- **Migración de Entorno a BD**: Creamos la tabla `email_settings` en MySQL para llevar un control permanente e independiente sobre qué método de envío usar para clientes (SendPulse API vs Gmail SMTP) sin depender de variables de entorno estáticas.
- **Auto-Reset Inteligente**: El servidor verifica la fecha (`last_reset_date`); si es un nuevo día, los contadores diarios de los envíos de Gmail se reinician automáticamente a 0, protegiendo al sistema de bloqueos por superar el límite gratuito de Google. SendPulse mantiene un conteo acumulativo total.
- **UI Dinámica en Administrador**: Se diseñó e integró una interfaz moderna dentro del Panel de Administración (Configuración ⚙️) que muestra en tiempo real cuántos mensajes se han despachado hoy por cada correo. Cuenta con botones reactivos para alternar en un clic entre SendPulse o Gmail sin necesidad de tocar el código.

---

## 17. Correcciones Críticas de API y Sistema
- **Error 422 de SendPulse**: Se corrigió un bloqueo en el envío por SendPulse. La plataforma rechaza tajantemente correos salientes cuyo remitente ("From") no esté validado en su propio Dashboard (ej. intentar enviar un correo como si fuera Gmail desde SendPulse sin verificarlo). Modificamos la API para priorizar siempre el correo oficial de SendPulse (`SENDPULSE_SENDER_EMAIL`).
- **Bug 404 Vercel Local**: Se solventó y clarificó un problema donde `vercel dev` colapsaba ante mínimos errores de sintaxis en NodeJS, resultando en respuestas "404 NOT_FOUND" globales en todos los endpoints `/api/*` y requiriendo reinicios forzados en Windows.
- **Despliegue a Producción Limpio**: Previo al pase final a producción, se ejecutó una depuración y borrado completo (`TRUNCATE`) de los pedidos ficticios de prueba, reseteando los autoincrementables y entregando la base de datos inmaculada.
- **Error de Lectura de Sitemap**: Solucionamos la incompatibilidad del sitemap con Google Search Console. Al eliminar el doble slash en las URLs generadas, agregar `<lastmod>` y remover los archivos estáticos que bloqueaban la redirección de Vercel, el sitemap se sirve de manera totalmente compatible e indexable en producción.

---

## 18. Optimización de Transiciones y Menús del Header (Móvil & PC)
- **Reducción de Ruido Visual**:
  - Eliminamos el botón de "Ir a catálogo" del header en móviles para maximizar el espacio útil.
  - Ocultamos el botón "Beneficios" del menú de navegación superior en PC para una interfaz más despejada y elegante.
- **Lógica Matemática de Scroll y Animaciones**:
  - Rediseñamos completamente la lógica de transición `updateLogoTransition` en `public/index.js`. En lugar de llamar de forma repetitiva y costosa a `getBoundingClientRect()` (lo cual provocaba *layout thrashing* e interrupciones en la renderización), calculamos matemáticamente el escalado del logo y los iconos en base a las posiciones absolutas.
  - **Sincronización Fluida**: El buscador móvil extendido (con su texto interactivo "Buscar") y la sección de perfil (con el nombre del usuario o la etiqueta "Invitado") se contraen simultánea y proporcionalmente al hacer scroll hacia abajo, regresando de manera fluida a la lupa compacta y al avatar predeterminado de perfil.
  - **Límites de Pantallas Angostas (Responsive)**: Añadimos un límite dinámico para el ancho de la caja de búsqueda en pantallas de menos de 360px de ancho para evitar desbordes visuales o que se descuadre el botón del carrito de compras (bolsa) en la barra de navegación móvil.

# SUT STE

PWA de gestión documental: subes un documento, obtienes un resumen con la información relevante, se archiva en la carpeta que corresponde según tus parámetros y el sistema te dice si conviene responder o solo archivar. Después redactas tu respuesta a partir de una plantilla con los datos ya detectados.

Diseño minimalista en tonos azules, sin emojis, responsivo e instalable en PC y móvil con datos consistentes entre dispositivos.

---

## Vercel + Neon: sí es viable

Es justo el stack recomendado hoy (Vercel retiró su Postgres propio en diciembre de 2024 y migró a todos a Neon).

| Pieza | Rol | Plan gratuito |
|---|---|---|
| **Vercel** | Frontend Next.js + PWA + Serverless Functions (API) | 100 GB de transferencia, 1M de invocaciones, 4 h de CPU al mes |
| **Neon** | Postgres serverless: documentos, resumen, clasificación, parámetros | 0.5 GB por proyecto, 100 CU-horas/mes, escala a cero |
| **Vercel Blob** | Archivo original (PDF/DOCX) | 1 GB de almacenamiento, 10 GB de transferencia al mes |

Costo real esperado para un archivo sindical o de oficina: **0 USD/mes** dentro de esos límites. Unos 1 500 documentos con su texto extraído caben en los 0.5 GB de Neon; los binarios viven en Blob.

**Tres advertencias honestas:**

1. **El plan Hobby de Vercel es solo para uso no comercial.** Si SUT STE se usa en una organización con actividad comercial, o si te pagaron por desarrollarlo, los términos piden el plan Pro (20 USD/mes por desarrollador). Alternativas gratuitas que sí permiten uso comercial con el mismo código: Cloudflare Pages + Workers, Fly.io o un VPS.
2. **Al llegar a un límite, el proyecto se pausa** (no hay cobro automático). En Neon se suspende el compute hasta el siguiente ciclo; en Vercel se detiene el despliegue.
3. **Scale-to-zero** en Neon implica un arranque en frío de 300-500 ms en la primera consulta tras 5 minutos sin uso. Imperceptible para este caso.

El peso del OCR vive en `public/ocr` (30 MB en el repositorio). Vercel lo sirve como estáticos con CDN y solo se descarga la variante que cada equipo necesita; con 100 GB de transferencia mensual del plan Hobby alcanza para miles de instalaciones.

Lo que hace viable el esquema sin fricción:

- La extracción de texto y el resumen ocurren **en el navegador**, así que las Serverless Functions solo reciben metadatos y texto (nunca el binario), y no se topa uno con el límite de 4.5 MB del cuerpo de petición.
- El archivo original sube **directo del navegador a Vercel Blob** con un token de corta duración emitido por la API.
- El driver `@neondatabase/serverless` usa HTTP, que es lo correcto en funciones sin estado (nada de pools de conexiones abiertas).

---

## Qué hace

| Paso | Qué ocurre |
|---|---|
| 1. Subida | PDF, DOCX, TXT, MD, CSV o HTML hasta 40 MB. Arrastrar, seleccionar o pegar desde el portapapeles. |
| 2. Extracción | El texto se extrae **en el navegador** (pdf.js para PDF, descompresión OOXML para DOCX). El documento nunca viaja crudo al servidor. |
| 2b. OCR | Si el PDF o la imagen no tiene capa de texto, se aplica reconocimiento óptico con Tesseract (español e inglés), también en el navegador. |
| 3. Resumen | Motor extractivo en español: resumen de 3 a 5 oraciones + puntos clave (asunto, remitente, destinatario, folio, fechas, montos, petición). |
| 4. Entidades | Folios, fechas en formato español, montos en pesos, personas con título, instituciones, correos y teléfonos. |
| 5. Clasificación | Tipo de documento, carpeta y área según **tus parámetros** (palabras clave + expresiones regulares editables). |
| 6. Respuesta | Decide si requiere respuesta, explica las señales encontradas, asigna prioridad y detecta la fecha límite. |
| 7. Archivo | Se guarda el registro y el archivo original; queda sincronizado entre PC y móvil. |
| 8. Borrador | Genera una plantilla de oficio de respuesta con destinatario, folio y fechas, lista para editar, copiar o descargar. |

Todo se puede corregir antes de archivar y después desde la ficha del documento.

---

## Cómo probarla en local

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

La primera vez te pide crear la cuenta (correo + contraseña). Sin `DATABASE_URL` la app trabaja en **modo local**: los datos viven en IndexedDB del navegador y en `./.data` del servidor de desarrollo. Es perfecto para probar, pero no sincroniza entre dispositivos.

Para verificar el motor sin interfaz:

```bash
python3 scripts/generar-muestras.py   # crea 3 documentos de ejemplo en ./muestras
npx tsx scripts/test-engine.ts        # imprime resumen, clasificación y sugerencia
```

---

## Publicar en Vercel + Neon (sincronización real PC ↔ móvil)

> Paso a paso con una comprobación en cada etapa (Neon, tablas, Blob, variables y primer acceso): **[DESPLIEGUE.md](DESPLIEGUE.md)**. Si la URL del proyecto responde 404, revisa primero que el despliegue incluya `app/layout.tsx`, `app/page.tsx` y `app/globals.css`.

### 1. Repositorio

Sube esta carpeta a GitHub (o GitLab/Bitbucket).

### 2. Base de datos en Neon

1. Crea un proyecto en <https://neon.tech> (plan Free: 0.5 GB y 100 CU-horas por proyecto).
2. Copia la **connection string pooled**.
3. En tu equipo, con la connection string en `DATABASE_URL`:

```bash
cp .env.example .env.local    # pega DATABASE_URL y AUTH_SECRET
npm run db:migrate            # crea las tablas en Neon
```

`scripts/migrate.mjs` ejecuta `scripts/schema.sql` (usuarios, documentos, parámetros y ajustes). Es idempotente.

### 3. Almacenamiento de archivos en Vercel Blob

1. En el proyecto de Vercel: **Storage → Create → Blob**.
2. Conéctalo al proyecto; eso inyecta `BLOB_READ_WRITE_TOKEN` automáticamente.

Si no configuras Blob, la app avisa y guarda los archivos en disco (solo sirve en local: en Vercel el filesystem es de solo lectura).

### 4. Despliegue

1. **Vercel → Add New → Project → Import** tu repositorio.
2. Framework: Next.js (se detecta solo). Build `next build`, output por defecto.
3. Variables de entorno:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | Connection string **pooled** de Neon |
| `AUTH_SECRET` | Secreto largo y aleatorio (`openssl rand -base64 48`) |
| `BLOB_READ_WRITE_TOKEN` | Lo aporta la integración de Vercel Blob |
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` | Opcional, para resumen con IA |

4. Deploy. Al abrir la URL por primera vez, crea tu cuenta.
5. En el móvil: abre la misma URL y usa **Agregar a pantalla de inicio**. Mismos datos, misma cuenta.

### Verificación rápida

En **Parámetros y ajustes → Sincronización y respaldo** debe aparecer *Neon Postgres (nube)* y *vercel-blob*. Si dice *almacenamiento local de desarrollo*, falta `DATABASE_URL`.

---

## Consistencia entre PC y móvil

Modelo **local-first con cola de salida**:

1. Todo cambio se escribe primero en IndexedDB del dispositivo y se encola en un *outbox*.
2. El outbox se envía a `/api/documents/sync` (Neon) y se descargan los cambios remotos posteriores a la última marca.
3. Sincronización automática cada 45 s, al volver a primer plano, al recuperar la red y al cerrar la pestaña (`sendBeacon`). También manual desde la barra superior.
4. Conflicto: gana la versión más reciente (`rev` + `updated_at`). Los cambios viejos se descartan y el servidor devuelve el estado ganador.
5. Sin red la app sigue funcionando: se lee y se escribe en local; al reconectar se pone al día.

Además hay **respaldo manual** en JSON (exportar/importar) por si necesitas migrar o auditar.

---

## Parámetros de archivo

En **Parámetros y ajustes** editas tres catálogos:

- **Tipos de documento** (Oficio, Circular, Convenio, Contrato, Minuta, Solicitud, Notificación, Informe, Factura, Queja, Otros). Cada uno con palabras clave y expresiones regulares.
- **Carpetas** (Entrada, Salida, Asuntos laborales, Convenios y contratos, Mesas de trabajo, Finanzas, Jurídico, Recursos humanos, Archivo histórico). Pueden tener palabras clave propias; si las tienen, mandan sobre la regla por tipo.
- **Áreas** (Dirección, Secretaría General, Recursos Humanos, Finanzas, Jurídico, Afiliación, Externo).

En la pestaña **Reglas** defines qué carpeta corresponde a cada tipo y los datos de firma para el borrador de respuesta.

Puedes dar de alta tus propias categorías reales y borrar las que no uses. Los documentos ya archivados conservan su valor.

---

## OCR para documentos escaneados

Los PDF que son fotografías de papel no tienen texto seleccionable. SUT STE lo detecta y aplica **Tesseract.js** directamente en el navegador:

1. pdf.js dibuja cada página en un lienzo a 144 ppp.
2. Tesseract lee la imagen con el modelo de idioma que elijas (`spa`, `spa+eng` o `eng`).
3. El texto reconocido entra al mismo motor de análisis: resumen, entidades, clasificación y sugerencia de respuesta.

Todo está **autoalojado** en `public/ocr` (worker, núcleo WASM y `traineddata`), así que no depende de ningún CDN y funciona en redes cerradas. El service worker deja esos archivos en caché la primera vez.

| Archivo | Tamaño | Cuándo se descarga |
|---|---|---|
| `ocr/worker.min.js` | 109 KB | Al usar OCR por primera vez |
| `ocr/core/tesseract-core-*-lstm.wasm.js` | 3.7 a 4.5 MB | Una sola variante, según el SIMD del equipo |
| `ocr/lang/spa.traineddata.gz` | 2.1 MB | Primera vez; luego queda en caché del navegador |
| `ocr/lang/eng.traineddata.gz` | 2.9 MB | Solo si eliges español e inglés |

**Dónde se activa:**

- Al subir: casilla *Aplicar OCR cuando el documento no tenga texto*, con idioma y límite de páginas (1 a 30, por defecto 5). Solo corre si hace falta; un PDF con texto nunca pasa por OCR.
- En un documento ya archivado: pestaña **Texto extraído** → *Ejecutar OCR*. Descarga el archivo original, lo lee, rellena el texto y vuelve a generar resumen y clasificación. Después revisas y guardas.

**Qué esperar:** entre 2 y 6 segundos por página en un equipo normal; más en móvil. La confianza típica en un escaneo limpio de oficina es de 85 a 95%. Cuando el OCR se usa, la app lo indica en la ficha del documento y te pide verificar nombres, cifras y fechas, porque es donde más se equivoca (sellos, firmas, números con manchones).

Manuscritos, fotocopias de tercera generación y páginas con sellos encima del texto son los casos que peor salen. El archivo original siempre queda guardado, aunque el OCR no logre nada.

**Prueba rápida sin interfaz:**

```bash
python3 scripts/generar-escaneado.py   # crea un PDF de una página, solo imagen
npm run test:ocr                       # ejecuta Tesseract y muestra el análisis
```

Con la muestra incluida el resultado es: confianza 94%, 2.6 s, y recupera folio `SG/203/2026`, monto `$86,400.00`, fecha del documento, límite 30 de septiembre, remitente, destinatario y *sí requiere respuesta*.

---

## Resumen con IA (opcional)

Por defecto el resumen es **local**: gratis, sin límites, funciona sin red y el documento no sale de tu equipo.

Si prefieres un resumen generativo, define en Vercel:

```
LLM_PROVIDER=openai        # openai | gemini | openrouter
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini      # opcional
```

La ruta `/api/summarize` devuelve JSON estructurado con el mismo formato que el motor local.

---

## Estructura

```
app/
  layout.tsx, page.tsx, globals.css      interfaz (una sola pantalla con vistas)
  api/
    auth/login        alta de la primera cuenta, inicio y cierre de sesión
    documents         listado y ficha (GET/PATCH/DELETE lógico)
    documents/sync    sincronización bidireccional incremental
    params            catálogos de tipos, carpetas y áreas + ajustes
    system            estado del backend (Neon/local, Blob/disco, IA)
    upload            subida de archivo en desarrollo (disco)
    upload-token      client token para subida directa a Vercel Blob
    summarize         resumen con LLM (opcional)
    files/[...key]    sirve archivos locales en desarrollo
components/           AppShell, UploadView, DocsView, DocView, SettingsView, AuthGate, Icon
lib/
  summary-engine.ts   análisis: resumen, entidades, clasificación, sugerencia de respuesta
  extract-text.ts     extracción de texto de PDF y DOCX en el navegador
  ocr.ts              OCR con Tesseract: render de página, worker y progreso
  pipeline.ts         orquesta el ingreso de un documento
  response-template.ts plantilla del borrador de respuesta
  localdb.ts          IndexedDB (documentos, parámetros, outbox, ajustes)
  sync.ts             motor de sincronización local-first
  store.ts            adaptador Neon Postgres / JSON local
  auth.ts             sesiones JWT en cookie HttpOnly + bcrypt
scripts/
  schema.sql          esquema de base de datos
  migrate.mjs         aplica el esquema en Neon
  make-icons.mjs      genera los iconos de la PWA
  generar-muestras.py documentos de ejemplo con texto
  generar-escaneado.py PDF escaneado de ejemplo (solo imagen, para el OCR)
  test-engine.ts      prueba del motor por consola
  test-ocr.ts         prueba del OCR por consola
muestras/             PDF, DOCX, TXT y un escaneado de prueba
public/ocr/           motor Tesseract autoalojado (worker, WASM, idiomas)
```

---

## Notas y límites

- **PDF escaneados**: ya se resuelven con OCR en el navegador. El límite práctico es la calidad del escaneo y el número de páginas que elijas procesar.
- **.doc antiguo y Excel**: no se leen; conviértelos a DOCX o PDF. Con Excel, una alternativa es exportar la hoja a PDF y dejar que el OCR o la extracción hagan su trabajo.
- **Imágenes**: se leen con OCR (PNG, JPG, WEBP). Una foto torcida o con poca luz baja la precisión.
- **Plan Hobby de Vercel**: es solo para uso no comercial. Si la app es para una organización con actividad comercial, el plan Pro cuesta 20 USD/mes por desarrollador, o puedes desplegar el mismo código en Cloudflare Pages, Fly.io o un VPS.
- **Neon Free**: 0.5 GB de almacenamiento por proyecto y 100 CU-horas/mes. El texto de los documentos ocupa poco (cientos de documentos caben sin problema); los archivos binarios viven en Blob (1 GB en Hobby).
- La sesión dura 30 días en cookie HttpOnly. No hay recuperación de contraseña por correo todavía: si la pierdes, se restablece en la base de datos.

## Seguridad

- Contraseñas con bcrypt, sesión con JWT firmado (`AUTH_SECRET`) en cookie HttpOnly y SameSite=Lax.
- Cada consulta filtra por `owner_id`: un usuario no ve documentos de otro.
- Las subidas a Blob pasan por un token de corta duración emitido por el servidor, con tipos de contenido y tamaño máximos restringidos.
- Los archivos en Blob son públicos por URL no adivinable. Si necesitas acceso privado, cambia `access: "public"` por `"private"` en `lib/files.ts` y sirve el archivo con una URL firmada.

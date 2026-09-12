# Guía del proyecto SUT STE

Documento para quien **hereda este desarrollo a la mitad** y necesita entender qué es, cómo funciona, cómo se modifica, dónde vive y por qué se desplegó así.

Al final hay un glosario y un mapa de archivos. Si solo quieres publicarlo, ve directo a [DESPLIEGUE.md](DESPLIEGUE.md).

---

## 1. En una frase

SUT STE es una **aplicación web instalable** que toma los documentos que llegan a una oficina u organización sindical, **los resume, los clasifica y los archiva sola**, te dice si conviene responderlos y **redacta el borrador de la respuesta**.

No es un programa que se instala desde un `.exe`: se abre en el navegador (Chrome, Edge, Safari) y se puede "instalar" como si fuera una app del sistema.

## 2. Qué problema resuelve

El caso real: llega un oficio en PDF. Alguien tiene que (a) leerlo, (b) sacar el asunto, el folio, quién lo manda, la fecha límite y el monto, (c) decidir en qué carpeta va y si hay que contestarlo, (d) escribir la respuesta con el formato correcto, y (e) poder encontrarlo después. Con 20 documentos al día eso se vuelve un cuello de botella y se pierden plazos.

SUT STE automatiza los pasos (a) a (d) y deja el (e) como un archivo consultable y compartido entre la computadora y el celular.

## 3. Qué hace, paso a paso

| # | Etapa | Qué ocurre en concreto |
|---|---|---|
| 1 | **Subir** | Arrastras, seleccionas o pegas (Ctrl+V) un PDF, DOCX, TXT, MD, CSV o HTML, hasta 40 MB |
| 2 | **Extraer** | El texto se saca **en tu propio navegador**: pdf.js para PDF y descompresión OOXML para Word. El archivo no se procesa en ningún servidor ajeno |
| 2b | **OCR** | Si el PDF es un escaneo (una foto de papel, sin texto seleccionable), se aplica **reconocimiento óptico de caracteres** con Tesseract en el navegador. Detecta si hace falta por sí solo |
| 3 | **Resumir** | Un motor de análisis en español produce un resumen de 3 a 5 oraciones y una lista de puntos clave (asunto, remitente, destinatario, folio, fechas, montos, petición) |
| 4 | **Extraer entidades** | Folios (`SG/147/2026`), fechas en formato español, montos en pesos, nombres con título (LIC., ING.), instituciones, correos y teléfonos |
| 5 | **Clasificar** | Decide tipo de documento (Oficio, Circular, Convenio…), carpeta y área **según los parámetros que tú defines** (palabras clave y expresiones regulares editables) |
| 6 | **Sugerir respuesta** | Decide si requiere respuesta, explica por qué (señales encontradas), asigna prioridad y detecta la fecha límite |
| 7 | **Archivar** | Guarda el registro y el archivo original. Todo se sincroniza entre dispositivos |
| 8 | **Borrador** | Genera la plantilla de oficio de respuesta (lugar, fecha, folio, destinatario, PRESENTE) lista para editar, copiar o descargar |

Todo es corregible: antes de archivar puedes ajustar cualquier campo, y después desde la ficha del documento puedes volver a analizarlo, correrle OCR o cambiar su clasificación.

## 4. Cómo funciona por dentro

### Las tres capas (piensa en una oficina)

| Capa | En la analogía | Qué es en realidad |
|---|---|---|
| **Tu navegador** | El escritorio donde se trabaja | La interfaz y **todo el análisis** (resumen, clasificación, OCR). Guarda una copia de los datos en el propio dispositivo (IndexedDB) |
| **El servidor (API)** | El archivador central y el mensajero | Rutas en `/api/...` que atienden el inicio de sesión, la sincronización, los catálogos y la autorización de subidas |
| **La nube** | La bodega y la caja fuerte | **Neon** (base de datos Postgres) guarda usuarios, documentos, texto, parámetros y ajustes. **Vercel Blob** guarda el archivo original (PDF/DOCX) |

```
   TÚ (PC o celular)
   ┌──────────────────────────────────────────┐
   │  Navegador = la app                      │
   │  · IndexedDB: copia local de todo        │
   │  · Motor de resumen + OCR (aquí)         │
   └───────┬──────────────────────┬───────────┘
           │ 1. sube el binario   │ 2. manda texto y metadatos
           ▼ (directo, con token) ▼
   ┌───────────────┐      ┌──────────────────┐
   │ Vercel Blob   │      │ Neon Postgres    │
   │ archivo       │      │ registros        │
   │ original      │      │ + índice de      │
   └───────────────┘      │ búsqueda         │
                          └──────────────────┘
           ▲
           │ 0. pide sesión, catálogos y sincronización
   ┌───────┴──────────────────────────────────┐
   │ API de Next.js en Vercel (funciones)     │
   └──────────────────────────────────────────┘
```

### Por qué funciona sin internet y cómo se sincroniza

El modelo se llama **local-first con cola de salida**:

1. Cada cambio se escribe primero en el dispositivo (IndexedDB) y se apunta en una "bandeja de salida" (outbox).
2. Cada 45 segundos —y también al volver a la pestaña, al recuperar la red y al cerrar— la bandeja se envía a `/api/documents/sync` y se baja lo que cambió en otros dispositivos.
3. Si hay conflicto, gana la versión más reciente (`rev` + `updated_at`).
4. Sin red, la app sigue leyendo y escribiendo en local; al reconectar se pone al día.

### Qué se guarda y dónde (privacidad en términos claros)

- **El archivo binario** (el PDF) se sube desde tu navegador **directo a Vercel Blob** con un permiso temporal que emite el servidor. No pasa por el servidor de la aplicación.
- **El texto extraído y los metadatos** (resumen, folio, fechas…) sí se guardan en la base de datos, porque son lo que se comparte entre tu PC y tu celular.
- Las URL de los archivos son **públicas pero no adivinables** (llevan un identificador aleatorio). Si necesitas acceso privado estricto, hay que cambiar `access: "public"` por `"private"` en `lib/files.ts` y servir con URL firmada.
- Con `DATABASE_URL` vacío, **nada sale del equipo**: la app trabaja en modo local de prueba.

### Sesiones y seguridad

- Contraseñas con **bcrypt** (nunca se guardan en claro).
- Sesión con **JWT firmado** en una cookie `HttpOnly` (JavaScript no puede leerla), duración 30 días.
- Cada consulta filtra por `owner_id`: una cuenta no ve documentos de otra.
- El primer registro que se hace en una base vacía es el **administrador**; después, quien no tenga cuenta no puede entrar.

### Cómo decide la clasificación

Es un motor de reglas, no de IA generativa por defecto. Puntúa cada tipo de documento con:

- **Palabras clave** (valen más si aparecen en el encabezado de las primeras ~1 200 letras).
- **Expresiones regulares** para patrones (`oficio\s*(num|no)?\.?\s*[a-z0-9/-]+`).
- **Repeticiones**: si una palabra aparece varias veces, suma.
- Las **carpetas con palabras clave propias** mandan sobre la regla "carpeta según el tipo".
- Si nada supera el umbral, cae en *Otros* y en el área por defecto.

Todo eso se edita **sin programar** desde *Parámetros y ajustes* dentro de la app. Hay un resumen con IA **opcional**, apagado por defecto (`LLM_PROVIDER` + `LLM_API_KEY`).

## 5. En qué plataforma vive y con qué programas se trabaja

| Pieza | Tecnología | Para qué sirve | ¿Se puede cambiar? |
|---|---|---|---|
| Lenguaje | **TypeScript / JavaScript** | Todo el código | Es la base; cambiarlo equivaldría a reescribir |
| Framework web | **Next.js 15** (sobre **React 19**) | Interfaz + rutas de API en un solo proyecto | Sí, pero costoso |
| Estilos | **CSS** normal (`app/globals.css`) | Los colores, tamaños y acomodo | Sí, fácil |
| Base de datos | **PostgreSQL en Neon** (serverless) | Guardar usuarios, documentos y parámetros | Sí (cualquier Postgres) |
| Archivos | **Vercel Blob** | Guardar el PDF/DOCX original | Sí (S3, R2, disco…) |
| PDF / Word | **pdf.js** y **fflate** | Sacar el texto en el navegador | Sí |
| OCR | **Tesseract.js** autoalojado | Leer escaneos, sin depender de internet externo | Sí |
| Sesiones | **jose** (JWT) y **bcryptjs** | Login seguro | Sí |
| Alojamiento | **Vercel** | Publicar la app en internet | Sí (Cloudflare, Fly.io, VPS) |
| Guardado del código | **Git + GitHub** | Historial y respaldo del proyecto | Sí |
| Editor recomendado | **VS Code** | Programar | Cualquiera |

**En tu computadora necesitas:** Node.js 20 o superior (`node -v`), npm, Git y un editor. Nada de Visual Studio, .NET ni compiladores de Windows.

**El editor de la app (y su versión más reciente) es Vercel**, no tu computadora: cuando el código cambia en GitHub, Vercel recompila y publica solo.

## 6. Cómo modificarla

### Nivel 1 — Sin programar (lo que cubre el 80 % de los cambios de oficina)

Todo esto se hace **dentro de la aplicación**, en *Parámetros y ajustes*:

- Dar de alta tipos de documento, carpetas y áreas propias, con sus palabras clave y expresiones.
- Definir qué carpeta corresponde a cada tipo y el área por defecto.
- Escribir los datos de firma (organización, cargo, área, ciudad) que usa el borrador de respuesta.
- Exportar/importar todo el archivo en JSON como respaldo.

Los **catálogos por defecto** (los que aparecen en una instalación nueva) se editan en `lib/schema-defs.ts` → constantes `DEFAULT_DOC_TYPES`, `DEFAULT_FOLDERS` y `DEFAULT_AREAS`. Ojo: eso solo afecta instalaciones nuevas; lo que ya está guardado vive en la base de datos.

### Nivel 2 — Cambios de texto, color o diseño

| Quiero cambiar | Archivo |
|---|---|
| Colores de toda la app | `app/globals.css`, bloque `:root` (arriba del archivo) |
| Tamaños, espaciados, cómo se ve en celular | `app/globals.css` (sección `@media` al final) |
| Nombre de la app, descripción, iconos | `app/layout.tsx`, `public/manifest.webmanifest` y `scripts/make-icons.mjs` |
| Palabras de las pantallas | Los textos están en `components/*.tsx` |

### Nivel 3 — Cambios de lógica (programando)

| Quiero cambiar | Archivo | Nota |
|---|---|---|
| Cómo se resume y qué entidades detecta | `lib/summary-engine.ts` (884 líneas) | Es el corazón; se prueba sin interfaz |
| Cómo se clasifica | `lib/summary-engine.ts` → `classify()` | |
| La plantilla del borrador de respuesta | `lib/response-template.ts` | |
| Lectura de PDF / DOCX / TXT | `lib/extract-text.ts` | |
| OCR (idiomas, páginas, resolución) | `lib/ocr.ts` | |
| El flujo de ingreso de un documento | `lib/pipeline.ts` | |
| Login, sesión, contraseñas | `lib/auth.ts` | |
| Guardar/leer en Neon o en disco | `lib/store.ts` | |
| Sincronización | `lib/sync.ts` y `lib/localdb.ts` | |
| Rutas del servidor (endpoints) | `app/api/*/route.ts` | |
| Tablas de la base de datos | `scripts/schema.sql` | Después: `npm run db:migrate` |

### Probar cada cambio

```bash
npm run dev          # abre http://localhost:3000 con recarga automática
npm run test:engine  # imprime resumen, clasificación y sugerencia de las muestras
npm run test:ocr     # prueba el OCR de consola sobre el escaneo de muestra
npm run build        # comprueba que todo compila antes de publicar
```

### Publicar los cambios

```bash
git checkout -b mi-cambio     # trabajar en una rama, no directo en main
# ...editar...
git add -A
git commit -m "Describe el cambio"
git push                      # Vercel recompila y publica solo
```

En Vercel cada *push* genera un despliegue. En GitHub se puede revisar el cambio como *Pull Request* antes de mezclarlo: es la red de seguridad para no romper lo que ya funcionaba.

### Reglas de oro (qué NO tocar)

- No edites a mano `node_modules/`, `.next/`, `.data/` ni `tsconfig.tsbuildinfo`: son archivos generados. Si algo se corrompe, se borran y se regeneran.
- No borres `public/ocr/` (son ~30 MB: el motor de OCR y los idiomas) ni `public/sw.js`: sin ellos no hay lectura de escaneos ni app instalable.
- Si cambias `scripts/schema.sql`, **aplícalo** con `npm run db:migrate` o la app fallará al guardar.
- Cualquier variable nueva (`process.env.X`) hay que declararla también en Vercel.
- Antes de tocar `lib/summary-engine.ts`, corre `npm run test:engine` para tener una referencia de cómo se comportaba antes.

## 7. Cómo instalarla y verificar que funciona

### A) En tu computadora, sin configurar nada (modo de prueba)

```bash
npm install
npm run build
npm start            # http://localhost:3000
```

Crea la cuenta en la pantalla de acceso. En este modo los datos viven en el navegador y en `./.data` de tu equipo: sirve para probar, no sincroniza entre dispositivos.

**Verificación mínima (5 minutos):** sube `muestras/oficio-solicitud-plazo.pdf` → debe detectar folio `SG/147/2026`, fecha límite 22 de septiembre, monto `$1,250,000.00`, tipo *Oficio*, carpeta *Entrada* y responder **sí requiere respuesta**. Después sube `muestras/oficio-escaneado-sin-texto.pdf` → debe avisar que aplicó OCR y darte un resumen con 85–95 % de confianza. Y en *Parámetros y ajustes → Sincronización y respaldo*, en modo local debe decir *Almacenamiento local de desarrollo*.

### B) En internet, con datos compartidos entre PC y celular

Sigue **[DESPLIEGUE.md](DESPLIEGUE.md)**: crear la base en Neon, aplicar las tablas (`npm run db:migrate`), conectar Vercel Blob, poner las variables de entorno y hacer *Redeploy*. La comprobación final es que en *Sincronización y respaldo* diga **Neon Postgres (nube)**.

### C) Instalarla como aplicación

En PC (Chrome/Edge): icono de instalación en la barra de direcciones. En iPhone: *Compartir → Agregar a pantalla de inicio*. En Android: menú → *Instalar aplicación*. Se abre en su propia ventana, con su icono, y funciona sin conexión.

## 8. ¿Por qué GitHub + Vercel y no una app nativa de Windows?

Es la pregunta más importante al heredar un proyecto así. Primero, qué es cada cosa:

- **GitHub** no es el servidor de la app: es **el archivo histórico del código**. Guarda cada versión, permite regresar a una anterior y es de donde Vercel toma lo que va a publicar.
- **Vercel** es **el servidor de la app**: compila el proyecto, lo publica en una dirección de internet y ahí corren las rutas de `/api/...`.

### Lo que gana este diseño

| Ventaja | Detalle |
|---|---|
| Un solo desarrollo para todos | La misma dirección sirve en PC, tablet y celular. Una app nativa de Windows no corre en el teléfono |
| Nada que instalar ni actualizar | Publicas una vez y todos ven la versión nueva al recargar. Con un `.exe` hay que instalarlo y actualizarlo equipo por equipo |
| No hay servidores que administrar | No hay que rentar ni mantener una máquina con Windows Server, ni configurar respaldo, ni parchar el sistema |
| Sigue funcionando sin internet | El análisis, el OCR y la consulta del archivo están en el navegador; lo que se captura sin red se sube al reconectar |
| Se instala como app | Es una **PWA**: icono, ventana propia, sin barra del navegador |
| Costo casi nulo | Dentro de los planes gratuitos: Vercel Hobby, Neon Free y Blob Free |
| Acceso desde cualquier lado | Con la cuenta puedes consultar el archivo desde otro edificio o ciudad, y con respaldo en la nube |

### Lo que se pierde (con honestidad)

- **Depende de internet y de un proveedor.** Si Vercel o Neon tienen un problema, la app no sincroniza (ya instalada, sigue funcionando con la copia local).
- **Los documentos salen de la red de la organización**: el texto va a Neon y el archivo a Vercel Blob. Para datos muy sensibles esto puede ser un obstáculo legal o de política interna.
- **No hay integración profunda con Windows**: nada de arrastrar desde el Explorador a un árbol de carpetas del sistema, ni imprimir directo con un comando del sistema, ni compartir con Outlook.
- **Plan Hobby no comercial.** Los términos de Vercel permiten el plan gratuito solo para uso no comercial. Si la organización cobra por esto o es una empresa con actividad comercial, hay que pasar al plan Pro (unos 20 USD/mes por desarrollador) o mover el mismo código a Cloudflare Pages, Fly.io o un VPS.
- **Puede haber sorpresas de costos** si se crece mucho, aunque los tres planes gratuitos cubren de sobra una oficina: los límites actuales son del orden de 0.5 GB en la base, 1 GB de archivos y 100 GB de tráfico mensual.

### Comparación directa

| | Web instalable (lo actual) | App nativa de Windows |
|---|---|---|
| Plataformas | PC, Mac, Android, iOS | Solo Windows |
| Instalación | Abrir una URL / botón *Instalar* | Instalador `.exe` en cada equipo |
| Actualizar | Automático (un push) | Reinstalar equipo por equipo |
| Móvil | Sí, la misma app | Habría que hacer otra app aparte |
| Sin internet | Sí, con copia local y cola de salida | Sí, nativo |
| Datos | En la nube (compartidos) | En el disco de cada PC (se desincronizan) |
| Integración con el sistema | Limitada | Total |
| Mantenimiento para quien lo opera | Ninguno | Respaldos, versiones, antivirus, firmas |
| Costo | 0 USD en los planes gratuitos | Tu tiempo y las licencias del equipo |

### Si algún día conviene migrar a algo de escritorio

Se puede, y **no se tira el trabajo**: la interfaz (React) y todo el motor (resumen, clasificación, OCR) se reutilizan tal cual. Lo que cambia es dónde se guardan las cosas: se sustituye Neon por **SQLite** y Vercel Blob por el disco del equipo, y se empaqueta con **Electron** o **Tauri** para generar un `.exe`. Es un trabajo de días, no de meses.

Considera esa ruta si: la organización exige que los documentos **nunca salgan de su red**, no hay internet confiable, o el uso se vuelve claramente comercial y no quieren pagar el plan Pro. Alternativa intermedia: mantener la misma app web pero **alojada en un servidor propio** (incluso dentro de la organización) apuntando a un Postgres local — se cambian solo las variables de entorno.

## 9. Estado del proyecto y qué falta

### Lo que ya está completo y funcionando

- Interfaz completa (subir, archivo con filtros y orden, ficha del documento, parámetros y ajustes) y app instalable con caché sin conexión.
- Motor de resumen, entidades, clasificación y decisión de respuesta (884 líneas, con prueba de consola).
- Extracción de texto en el navegador y OCR de escaneos (~94 % de confianza en la muestra incluida).
- Sincronización local-first entre dispositivos, con respaldo manual en JSON.
- Login con sesiones, aislamiento por usuario y las seis rutas de API.
- Despliegue en Vercel con Neon y Blob, y documentación ([README.md](README.md), [DESPLIEGUE.md](DESPLIEGUE.md)).

> Nota histórica: el repositorio llegó **incompleto**. Faltaban la página, el layout, la hoja de estilos y seis rutas de API, por lo que la URL de Vercel respondía 404. Se reconstruyeron y se verificaron en local (compilación, login, siembra de catálogos, sincronización, subida/descarga del archivo y control de acceso). Ver el Pull Request #1.

### Pendientes reales (nada de esto es urgente)

| Pendiente | Por qué importa |
|---|---|
| Recuperación de contraseña por correo | Hoy, si se pierde, hay que borrar al usuario en Neon y volver a registrarlo |
| Invitaciones y roles (editor / solo consulta) | El registro solo funciona una vez; las demás cuentas hay que crearlas a mano |
| Pruebas automáticas | Hay pruebas de motor y OCR por consola, pero no de interfaz ni de API |
| Exportar el borrador a PDF o Word | Hoy se copia o descarga como texto |
| .doc antiguo y Excel | No se leen; hay que convertirlos a DOCX o PDF |
| Búsqueda dentro del texto de todos los documentos | Hoy se busca en título, resumen, folio y remitente |
| Bitácora de cambios (auditoría) | No hay historial de quién modificó qué |

### Decisiones que debe tomar quien herede el proyecto

1. ¿El uso es **no comercial** (sigue en plan gratuito) o comercial (Plan Pro o servidor propio)?
2. ¿Los documentos pueden **salir de la organización** (nube) o deben quedarse dentro (servidor propio o app de escritorio)?
3. ¿Quién tiene acceso a GitHub, Vercel y Neon? Esas tres cuentas **son** el proyecto: sin ellas no hay código, ni app, ni datos.
4. ¿Con qué frecuencia se respalda? Hoy es manual, desde *Sincronización y respaldo* (exportar JSON) y con el respaldo automático de Neon.

## 10. Glosario

| Término | En palabras llanas |
|---|---|
| **Repositorio** | La carpeta del proyecto con todo su historial de cambios |
| **Git / GitHub** | El sistema y el sitio donde se guarda ese historial |
| **Commit** | Una "foto" de los cambios, con descripción |
| **Rama (branch)** | Una copia paralela para trabajar sin afectar la versión buena |
| **Pull Request** | Propuesta de cambio que se revisa antes de unirla a la versión principal |
| **Push** | Enviar tus cambios al repositorio (y con ello disparar el despliegue) |
| **Build / compilar** | Convertir el código en la versión que el navegador entiende |
| **Deploy / desplegar** | Publicar la app en internet |
| **API / endpoint** | Dirección del servidor que responde datos (por ejemplo `/api/documents`) |
| **Variable de entorno** | Dato secreto de configuración (contraseñas, claves) que no va en el código |
| **Base de datos** | Donde viven los registros de forma ordenada y consultable |
| **PostgreSQL / Neon** | El motor de base de datos y el servicio en la nube que lo hospeda |
| **Blob** | Almacenamiento de archivos (aquí, los PDF y DOCX originales) |
| **PWA** | Página que se puede instalar como aplicación y funciona sin conexión |
| **Service worker** | El programa de fondo del navegador que guarda en caché para uso sin red |
| **IndexedDB** | La "bodega" del navegador, donde vive la copia local de los datos |
| **local-first** | Se trabaja primero en el dispositivo y luego se sincroniza |
| **OCR** | Reconocimiento óptico de caracteres: leer texto de una imagen |
| **JWT / cookie HttpOnly** | La credencial de sesión y su caja fuerte en el navegador |
| **Seed / siembra** | Cargar los catálogos por defecto la primera vez |

## 11. Mapa de archivos

```
README.md               Qué es y cómo se usa (visión general)
DESPLIEGUE.md           Paso a paso para publicar en Vercel + Neon + Blob
GUIA.md                 Este documento
package.json            Dependencias y comandos (dev, build, test, db:migrate)

app/
  layout.tsx            Marco de la página: título, PWA, service worker
  page.tsx              Página única que monta la aplicación
  globals.css           Todos los estilos (colores en :root)
  api/                  Rutas del servidor
    auth/login/         Alta de la primera cuenta, entrar y salir
    system/             Estado: base de datos, sesión, Blob, IA
    params/             Catálogos y ajustes (sembrar, crear, editar, borrar)
    documents/          Listado y ficha (GET/PATCH/DELETE)
    documents/sync/     Sincronización bidireccional
    upload/             Subida a disco (solo desarrollo)
    upload-token/       Permiso para subir directo a Vercel Blob
    files/[...key]/     Sirve los archivos locales en desarrollo
    summarize/          Resumen con IA (opcional)

components/             Pantallas y piezas de interfaz
  AppShell.tsx          Estructura, navegación, arranque y sincronización
  AuthGate.tsx          Pantalla de acceso
  UploadView.tsx        Subir y revisar antes de archivar
  DocsView.tsx          Archivo con filtros, orden y búsqueda
  DocView.tsx           Ficha del documento (resumen, datos, texto, respuesta)
  SettingsView.tsx      Parámetros, reglas y respaldo
  Icon.tsx              Iconos (SVG en línea, sin librerías externas)
  ServiceWorkerRegister.tsx

lib/                    La lógica (sin interfaz)
  summary-engine.ts     Resumen, entidades, clasificación, plazos
  response-template.ts  Plantilla del oficio de respuesta
  extract-text.ts       Texto de PDF/DOCX/TXT/CSV/HTML en el navegador
  ocr.ts                OCR con Tesseract
  pipeline.ts           Orquesta el ingreso de un documento
  localdb.ts            IndexedDB: documentos, parámetros, outbox
  sync.ts               Motor de sincronización
  store.ts              Neon Postgres / JSON local
  auth.ts               Sesiones, contraseñas
  upload.ts / files.ts  Subida y guardado de archivos
  schema-defs.ts        Tipos, estatus y catálogos por defecto
  util.ts, api-helpers.ts

scripts/
  schema.sql            Tablas de la base de datos
  migrate.mjs           Aplica el esquema en Neon
  test-engine.ts        Prueba del motor por consola
  test-ocr.ts           Prueba del OCR por consola
  make-icons.mjs        Genera los iconos de la app
  generar-muestras.py   Documentos de ejemplo (requiere reportlab y python-docx)
  generar-escaneado.py  PDF escaneado de ejemplo (requiere Pillow y reportlab)

muestras/               Documentos de prueba listos para usar
public/                 Iconos, manifest, service worker y motor de OCR (~30 MB)
```

---

*Documento redactado para acompañar la entrega del proyecto. Si algo de aquí no coincide con el código, manda el código: esta guía describe el estado del repositorio en la fecha de su última actualización.*

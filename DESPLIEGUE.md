# Despliegue en Vercel + Neon + Blob

Guía corta y verificable. Al final de cada paso hay una **comprobación**: si no pasa, no sigas al siguiente.

---

## Lo que faltaba

El repositorio estaba incompleto: existían `lib/`, `components/` y las rutas `auth/login` y `documents`, pero **no** estaban los archivos que hacen visible la aplicación:

| Faltaba | Consecuencia |
|---|---|
| `app/layout.tsx`, `app/page.tsx`, `app/globals.css` | Vercel compilaba, pero `https://tu-proyecto.vercel.app/` respondía **404**: no había página de inicio |
| `/api/system` | La app no podía arrancar (no sabía si hay base de datos ni si había sesión) |
| `/api/params` | Sin tipos de documento, carpetas ni áreas: no se podía archivar nada |
| `/api/upload` y `/api/upload-token` | El archivo original no se podía guardar |
| `/api/files/[...key]` | No se podía volver a abrir el archivo guardado en local |
| `/api/summarize` | El resumen con IA opcional no existía |

Ya están todos en el proyecto. Falta lo que solo puedes hacer tú en tus cuentas: **base de datos, almacenamiento de archivos y variables de entorno**.

---

## Paso 1. Base de datos en Neon (gratis)

1. Entra a <https://neon.tech> y crea una cuenta.
2. **New Project** → nombre `sut-ste`, región la más cercana (por ejemplo `us-east-2`).
3. En **Connection string**, elige la cadena **Pooled** (la que incluye `-pooler`) y cópiala. Se ve así:

```
postgresql://usuario:contrasena@ep-xxxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
```

> Usa la **pooled**: el driver serverless abre conexiones por HTTP y la cadena directa se agota con las funciones de Vercel.

## Paso 2. Crear las tablas

En tu equipo, dentro de la carpeta del proyecto:

```bash
cp .env.example .env.local
```

Pega tu `DATABASE_URL` y un `AUTH_SECRET` inventado (`openssl rand -base64 48`) en `.env.local`, y luego:

```bash
npm install
npm run db:migrate
```

**Comprobación:** el comando imprime `Migracion aplicada: N sentencias ejecutadas en Neon.` En Neon, en **Tables**, deben aparecer `users`, `documents`, `params` y `settings`.

## Paso 3. Almacenamiento de archivos (Vercel Blob)

1. Entra a <https://vercel.com> → tu proyecto (si aún no existe, impórtalo primero: **Add New → Project → Import** tu repositorio de GitHub).
2. Pestaña **Storage** → **Create Database / Store** → **Blob**.
3. Conéctalo al proyecto. Vercel agrega solo la variable `BLOB_READ_WRITE_TOKEN`.

Sin este paso la app funciona, pero guarda los archivos en disco, y en Vercel el disco es de solo lectura: los documentos se analizan pero el archivo original no queda guardado.

## Paso 4. Variables de entorno en Vercel

**Project → Settings → Environment Variables** (marca los tres entornos: Production, Preview, Development):

| Variable | Valor | ¿Obligatoria? |
|---|---|---|
| `DATABASE_URL` | Cadena **pooled** de Neon | Sí |
| `AUTH_SECRET` | Cadena larga y aleatoria (`openssl rand -base64 48`) | Sí |
| `BLOB_READ_WRITE_TOKEN` | La agrega la integración de Blob | Recomendada |
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` | `openai` \| `gemini` \| `openrouter` + tu clave | Opcional |

## Paso 5. Desplegar

- Si acabas de importar el proyecto: **Deploy**.
- Si ya estaba desplegado y solo agregaste variables: **Deployments → ⋯ → Redeploy** (las variables nuevas no se aplican solas).

**Comprobación:** abre la URL del proyecto. Debe aparecer la pantalla azul de acceso con el texto *Primera vez: crea la cuenta de acceso*.

## Paso 6. Primera cuenta

En esa misma pantalla escribe correo, nombre y contraseña (mínimo 6 caracteres) y presiona **Crear cuenta y entrar**. El primer registro es el administrador; después, quien no tenga cuenta verá *Credenciales incorrectas*.

**Comprobación final:** entra a **Parámetros y ajustes → Sincronización y respaldo** y revisa:

- Backend: **Neon Postgres (nube)**
- Los catálogos (tipos, carpetas, áreas) aparecen sembrados.
- Sube un documento: debe quedar archivado y, al abrirlo en el móvil con la misma cuenta, aparecer también ahí.

---

## Si algo no sale

| Síntoma | Causa y solución |
|---|---|
| `404 NOT_FOUND` en la raíz | Faltan `app/page.tsx` y `app/layout.tsx`. En este proyecto ya están: confirma que el despliegue usa el commit más reciente |
| El aviso dice *Falta DATABASE_URL…* | En Vercel el disco es de solo lectura. Agrega `DATABASE_URL` y **Redeploy** |
| El aviso dice *Falta BLOB_READ_WRITE_TOKEN…* | Crea y conecta el almacén Blob al proyecto, luego **Redeploy** |
| Ajustes muestra *Almacenamiento local de desarrollo* | `DATABASE_URL` no llegó al despliegue, o no empieza con `postgres` |
| El archivo se analiza pero no se guarda | Falta Blob (arriba). En el detalle del documento aparece el aviso correspondiente |
| *Credenciales incorrectas* al crear la cuenta | La base ya tiene un usuario: usa ese correo o borra la fila en la tabla `users` de Neon |
| Se pierde la contraseña | Todavía no hay recuperación por correo: borra el usuario en Neon y vuelve a registrarlo |

---

## Notas

- **Plan Hobby de Vercel**: es solo para uso no comercial. Si la app se usa en una organización con actividad comercial, los términos piden el plan Pro, o desplegar el mismo código en Cloudflare Pages, Fly.io o un VPS.
- **Neon Free**: 0.5 GB y 100 CU-horas/mes, con suspensión del compute por inactividad (la primera consulta después de 5 minutos tarda 300-500 ms).
- El OCR (~30 MB en `public/ocr`) se sirve como archivo estático con caché del navegador; solo se descarga la variante que cada equipo necesita.
- **Respaldo**: en *Sincronización y respaldo* puedes exportar todo el archivo en un JSON, e importarlo en otro dispositivo.

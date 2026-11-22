# PaaS Smart Calendar — Despliegue de una aplicación en OpenShift

Trabajo individual de GSASD (Universidad de Córdoba) — Francisco Javier Albalá del Pino.

Tema: *Estudio y programación de una aplicación en una PaaS (Stackato, OpenShift, etc.)*.
Se ha programado una aplicación web de calendario y se ha desplegado en **Red Hat OpenShift
(Developer Sandbox)**.

---

## 1. La aplicación

Calendario inteligente con gestión de tareas:

- **Calendario interactivo** (FullCalendar): ver, arrastrar, redimensionar y borrar eventos.
- **Tablero Kanban** de tareas con tres columnas: `TODO`, `IN_PROGRESS` y `DONE`.
- **Time blocking automático** (`POST /api/schedule`): coloca las tareas pendientes en los huecos
  libres del calendario, por prioridad y fecha límite, dentro del horario elegido (9:00–20:00 por
  defecto) y mirando hasta 14 días por delante.
- **Agendado manual**: se arrastra una tarea al calendario y se crea su evento.
- **Analítica**: gráfico de horas por categoría (Chart.js).

### Arquitectura

```
Navegador ──HTTPS──► Route (OpenShift) ──► Service ──► Pod Node.js (Express)
                                                         │  sirve frontend/ (estático)
                                                         │  y la API REST /api/*
                                                         ▼
                                              Service postgresql ──► Pod PostgreSQL
                                                                     + volumen persistente
```

| Capa | Tecnología |
|---|---|
| Frontend | HTML + JavaScript; Tailwind CSS, FullCalendar 6.1.10 y Chart.js cargados por CDN |
| Backend | Node.js 20 + Express 5, `pg` (cliente de PostgreSQL), `cors`, `dotenv` |
| Base de datos | PostgreSQL (tablas `users`, `events` y `tasks`; esquema en `init.sql`) |
| Plataforma | Red Hat OpenShift (Developer Sandbox), construida a partir del `Dockerfile` |

### API

| Método | Ruta | Función |
|---|---|---|
| GET | `/health` | Comprobación de salud (para la plataforma) |
| GET | `/api/events` | Eventos en el formato de FullCalendar |
| PATCH | `/api/events/:id` | Mover o redimensionar un evento |
| DELETE | `/api/events/:id` | Borrar un evento (su tarea vuelve a `TODO`) |
| GET / POST | `/api/tasks` | Listar o crear tareas |
| PATCH | `/api/tasks/:id/status` | Cambiar la columna del Kanban |
| POST | `/api/tasks/:id/schedule-direct` | Agendar una tarea en una hora concreta |
| DELETE | `/api/tasks/:id` | Borrar una tarea y su evento |
| POST | `/api/schedule` | Time blocking automático |
| GET | `/api/analytics` | Horas por categoría |

### Preparada para una PaaS (*Twelve-Factor App*)

- La configuración llega por **variables de entorno**: `PORT`, `DATABASE_URL` y `TZ`. En local se
  usa un `.env`, que no se sube a Git.
- **Sin estado en el contenedor**: todo se guarda en PostgreSQL, así que el pod se puede reiniciar
  o replicar.
- Las **dependencias se declaran** en `package.json` / `package-lock.json` y la plataforma las
  instala al construir. La carpeta `node_modules` no se versiona.
- Tiene el endpoint **`/health`**, que la plataforma usa para saber si la app está viva.

---

## 2. Ejecución en local

Requisitos: Docker y Node.js.

```bash
docker compose up -d          # PostgreSQL 16; carga init.sql la primera vez
cd backend
npm install                   # regenera node_modules a partir de package-lock.json
npm start                     # http://localhost:3000
```

`backend/.env` (no versionado):

```
PORT=3000
DATABASE_URL=postgresql://paas_user:paas_password@localhost:5432/calendar_db
```

### Correcciones hechas antes de desplegar

1. **`init.sql` incompleto**: el backend guarda `description` y `category` en las tareas, pero el
   script no creaba esas columnas. En una base de datos nueva, como la de la PaaS, crear tareas
   fallaba. Se han añadido las dos columnas.
2. **`.gitignore`**: el repositorio incluía `backend/node_modules` (739 archivos) y `backend/.env`.
   Se han sacado del repositorio.
   - `node_modules` contiene las librerías que instala `npm`: las 4 declaradas y todas sus
     dependencias indirectas. Se regenera con `npm install`, así que no se sube; la PaaS la genera
     al construir.
   - `.env` contiene configuración y credenciales locales, que no deben ir en el código.
3. **`Dockerfile`** para que OpenShift construya la imagen (ver sección 3).

---

## 3. Contenedor (`Dockerfile`)

```dockerfile
FROM registry.access.redhat.com/ubi9/nodejs-20     # imagen oficial Node.js de Red Hat
COPY --chown=1001:0 backend/package*.json backend/
RUN cd backend && npm ci --omit=dev                # dependencias exactas del lock
COPY --chown=1001:0 backend/src backend/src
COPY --chown=1001:0 frontend frontend
ENV PORT=3000
EXPOSE 3000
CMD ["node", "backend/src/index.js"]
```

- Se usa un Dockerfile porque el repositorio tiene `backend/` y `frontend/` separados: si solo se
  construyera `backend/`, el frontend quedaría fuera.
- Se usa la imagen **UBI de Red Hat** porque está pensada para OpenShift. OpenShift ejecuta los
  contenedores con un **usuario aleatorio sin privilegios**, y esta imagen lo soporta.
- `.dockerignore` evita que `node_modules` y `.env` entren en la imagen.
- Se probó en local ejecutándolo con un usuario aleatorio, como hace OpenShift
  (`docker run --user 1000870000:0 ...`). La app y la API respondieron bien.

---

## 4. Despliegue en OpenShift (Developer Sandbox)

**Developer Sandbox**: entorno gratuito de Red Hat durante 30 días, sin tarjeta. Incluye un
proyecto (*namespace*) con 14 GB de RAM y 40 GB de almacenamiento.

### 4.1 Base de datos PostgreSQL

Se define como código en `openshift/postgresql.yaml` y se crea desde la consola con
**+ → Import YAML**. La versión actual de la consola del sandbox ya no muestra el catálogo de
plantillas. El YAML crea cuatro recursos:

| Recurso | Función |
|---|---|
| *Secret* `postgresql` | Credenciales: usuario `paas_user`, contraseña y base de datos `calendar_db` |
| *PersistentVolumeClaim* (1 GiB) | Disco persistente: los datos sobreviven a los reinicios del pod |
| *Deployment* | Ejecuta la imagen `quay.io/sclorg/postgresql-16-c9s`, la misma familia de imágenes PostgreSQL que usa Red Hat, y le pasa las credenciales del Secret |
| *Service* `postgresql:5432` | Nombre de red interno con el que la app encuentra la base de datos |

### 4.2 Esquema de la base de datos

Desde la **Terminal** del pod de PostgreSQL, en la consola web:

```bash
PGPASSWORD=$POSTGRESQL_PASSWORD psql -h localhost -U $POSTGRESQL_USER -d $POSTGRESQL_DATABASE
```

Después se pega el contenido de `init.sql`. Las tablas quedan a nombre del usuario de la
aplicación.

### 4.3 Aplicación (Import from Git)

Se importa el repositorio `https://github.com/javialbala/trabajo-gestion`. OpenShift detecta el
`Dockerfile`, construye la imagen con un *BuildConfig*, la guarda en su registro interno y la
despliega.

Ruta en la consola: botón **+ → Importar desde Git**. Se marca *Crear una ruta*, con
*Ruta segura*, terminación TLS *Edge* y tráfico no seguro *Redirigir*.

El formulario de esta versión de la consola no permite definir variables de entorno. Se añadieron
después en **Cargas de trabajo → Despliegues → calendar-app → Entorno**. Al guardar, OpenShift
crea un pod nuevo con la configuración nueva y elimina el anterior (*rolling update*), sin tocar el
código ni reconstruir la imagen.

| Variable | Valor |
|---|---|
| `DATABASE_URL` | `postgresql://paas_user:<contraseña>@postgresql:5432/calendar_db` (`postgresql` es el nombre del *Service* de la BD) |
| `TZ` | `Europe/Madrid` (las fechas se guardan sin zona horaria y el clúster funciona en UTC) |
| `PORT` | `8080` (puerto al que OpenShift dirige el tráfico; ver 4.6) |

No se define `NODE_ENV=production`, porque activaría SSL en la conexión, y el PostgreSQL interno
del clúster no lo usa.

### 4.4 Exposición pública (Route)

*Route* segura con terminación TLS **edge**: OpenShift aporta el certificado HTTPS y el dominio
público, y redirige HTTP a HTTPS.

**URL pública:** https://calendar-app-javialbala-dev.apps.rm2.thpm.p1.openshiftapps.com/

Comprobado: `/health` responde `{"status":"ok"}`, la API devuelve los datos de `init.sql` y una
petición por `http://` se redirige con un 302 a `https://`.

### 4.5 Qué aporta la PaaS frente a hacerlo a mano

| Tarea | Lo hace |
|---|---|
| Escribir el código y el Dockerfile | Desarrollador |
| Construir la imagen desde Git | OpenShift (BuildConfig) |
| Registro de imágenes | OpenShift (registro interno) |
| Ejecutar, reiniciar si cae, escalar | OpenShift (Deployment, Kubernetes por debajo) |
| Red interna entre app y BD | OpenShift (Services) |
| Dominio público y HTTPS | OpenShift (Route) |
| Almacenamiento persistente de la BD | OpenShift (PVC) |
| Configuración y credenciales | Variables de entorno y Secrets |

### 4.6 Problemas encontrados durante el despliegue

| Problema | Causa | Solución |
|---|---|---|
| La consola no muestra el catálogo de plantillas de PostgreSQL | La versión actual de la consola del sandbox lo ha cambiado o eliminado | Crear PostgreSQL con **Importar YAML** (`openshift/postgresql.yaml`) |
| Error al crear el Secret: *cannot unmarshal number into ... string* | En YAML, `1234` sin comillas es un número y un Secret solo admite texto | Poner la contraseña entre comillas: `"1234"` |
| Al reintentar salía *already exists* | Esos recursos ya se habían creado en el intento anterior | Nada: solo faltaba crear el Secret |
| La URL mostraba *Application is not available* aunque el pod estaba *Running* | La app escuchaba en el puerto 3000 y OpenShift enviaba el tráfico al 8080 | Variable `PORT=8080`: la app lee el puerto del entorno (*Twelve-Factor*) |

---

## 5. Tecnologías

| Usadas | Estudiadas como referencia | Descartadas |
|---|---|---|
| Node.js, Express, PostgreSQL | Stackato (HPE Helion Stackato): PaaS histórica basada en Cloud Foundry, ya discontinuada | Kubernetes "a mano": demasiado complejo; OpenShift lo abstrae |
| Docker (imagen UBI) y Docker Compose en local | Render y Railway: PaaS alternativas, con Postgres gratuito limitado a 30 días en Render | Construir una PaaS propia: fuera del alcance del tema |
| Red Hat OpenShift Developer Sandbox | Cloud Foundry | |
| FullCalendar, Chart.js, Tailwind (CDN) | | |

## 6. Limitaciones

- Sin autenticación: hay un único usuario fijo (`user_id = 1`).
- El Developer Sandbox caduca a los 30 días y puede parar los pods si nadie los usa (se vuelven a
  levantar desde la consola).
- La contraseña de la BD es débil (`1234`), está escrita en `openshift/postgresql.yaml` (que está
  en el repositorio público) y va directamente en `DATABASE_URL`. Lo correcto sería generarla
  aleatoriamente y que la app la leyera del *Secret* de PostgreSQL.
- Las librerías del frontend dependen de CDN externos.

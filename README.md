# 📄 Sistema de Control de Resoluciones DIAN

Sistema web para el registro y control de resoluciones de facturación emitidas por la **DIAN** (Dirección de Impuestos y Aduanas Nacionales de Colombia).

## 🛠 Tecnologías

- **Node.js** + **Express** — Servidor web
- **SQLite** (via `better-sqlite3`) — Base de datos embebida, sin configuración adicional
- **EJS** — Motor de plantillas HTML
- **CSS personalizado** — Diseño profesional inspirado en la identidad institucional DIAN

## 📦 Instalación

### Requisitos previos
- Node.js 16+ instalado: https://nodejs.org

### Pasos

```bash
# 1. Entrar a la carpeta del proyecto
cd dian-resoluciones

# 2. Instalar dependencias
npm install

# 3. Iniciar el servidor
npm start
```

Abrir en el navegador: **http://localhost:3000**

## 🚀 Desarrollo

Para desarrollo con reinicio automático al guardar cambios:

```bash
npm run dev
```

## 📋 Campos del Formulario

| Campo | Descripción |
|---|---|
| NIT | Número de Identificación Tributaria del tercero |
| Nombre / Razón Social | Nombre del contribuyente |
| Fecha de Resolución | Fecha en que la DIAN emitió la resolución |
| Número de Resolución | Número único asignado por la DIAN |
| Modalidad | Tipo de facturación (D.E./P.O.S., Electrónica, Papel, etc.) |
| Solicitud | Tipo: Autorización, Habilitación o Inhabilitación |
| Prefijo | Prefijo de la numeración (ej: FE, FV) — opcional |
| Sucursal | Dirección de la sucursal — opcional |
| Desde | Número inicial del rango autorizado |
| Hasta | Número final del rango autorizado |
| Vigencia | Fecha de vencimiento o "Indefinida" |

## 📂 Estructura del Proyecto

```
dian-resoluciones/
├── app.js              # Punto de entrada principal
├── package.json        # Dependencias del proyecto
├── db/
│   └── database.js     # Configuración SQLite (auto-crea resoluciones.db)
├── routes/
│   └── resoluciones.js # Rutas CRUD completas
├── views/
│   ├── index.ejs       # Listado con filtros y estadísticas
│   ├── form.ejs        # Formulario crear/editar
│   └── detail.ejs      # Vista detallada de una resolución
└── public/
    └── css/
        └── style.css   # Estilos del sistema
```

## 🗄 Base de Datos

La base de datos SQLite se crea automáticamente en `db/resoluciones.db` al iniciar por primera vez. No requiere instalación ni configuración de un servidor de base de datos.

## 🔧 Personalización del Puerto

Por defecto el servidor corre en el puerto **3000**. Para cambiarlo:

```bash
PORT=8080 npm start
```

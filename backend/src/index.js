const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./db');
const { autoScheduleTasks } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Servir la carpeta frontend estática
app.use(express.static(path.join(__dirname, '../../frontend')));

// Endpoint de verificación (Health Check PaaS)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Obtener todos los eventos formateados para FullCalendar
app.get('/api/events', async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        title,
        description,
        start_time AS start,
        end_time AS end,
        color_hex AS "backgroundColor",
        color_hex AS "borderColor",
        category
      FROM events 
      ORDER BY start_time ASC
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener todas las tareas (Kanban)
app.get('/api/tasks', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM tasks ORDER BY priority DESC, due_date ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear una nueva tarea
app.post('/api/tasks', async (req, res) => {
  const { user_id, title, description, category, estimated_minutes, due_date, priority } = req.body;
  try {
    const query = `
      INSERT INTO tasks (user_id, title, description, category, estimated_minutes, due_date, priority)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
    `;
    const { rows } = await db.query(query, [
      user_id || 1,
      title,
      description || '',
      category || 'Estudio',
      estimated_minutes || 60,
      due_date,
      priority || 1
    ]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error al insertar tarea:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Actualizar estado de una tarea
app.patch('/api/tasks/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const { rows } = await db.query('UPDATE tasks SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mover o redimensionar un evento en el calendario
app.patch('/api/events/:id', async (req, res) => {
  const { id } = req.params;
  const { start, end } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE events SET start_time = $1, end_time = $2 WHERE id = $3 RETURNING *`,
      [new Date(start), new Date(end), id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agendar una tarea directamente arrastrándola al calendario
app.post('/api/tasks/:id/schedule-direct', async (req, res) => {
  const { id } = req.params;
  const { start, durationMinutes } = req.body;

  try {
    const taskRes = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (taskRes.rows.length === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
    const task = taskRes.rows[0];

    const slotStart = new Date(start);
    const duration = durationMinutes || task.estimated_minutes || 60;
    const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

    const newEvent = await db.query(
      `INSERT INTO events (user_id, title, description, start_time, end_time, color_hex, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        task.user_id, 
        task.title, 
        task.description || `Tarea manual: ${task.title}`, 
        slotStart, 
        slotEnd, 
        '#3b82f6', 
        task.category || 'Tarea'
      ]
    );

    await db.query(
      `UPDATE tasks SET scheduled_event_id = $1, status = 'IN_PROGRESS' WHERE id = $2`,
      [newEvent.rows[0].id, id]
    );

    res.json({ event: newEvent.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Algoritmo de Time Blocking automático
app.post('/api/schedule', async (req, res) => {
  const { startHour, endHour } = req.body;
  try {
    const result = await autoScheduleTasks(1, startHour || 9, endHour || 20);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar un evento del calendario directamente (clic en calendario)
app.delete('/api/events/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(
      `UPDATE tasks SET scheduled_event_id = NULL, status = 'TODO' WHERE scheduled_event_id = $1`,
      [id]
    );
    await db.query('DELETE FROM events WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar tarea (desde columna completados o cualquier sitio)
app.delete('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Obtener el evento vinculado si existía
    const taskRes = await db.query('SELECT scheduled_event_id FROM tasks WHERE id = $1', [id]);
    const eventId = taskRes.rows[0]?.scheduled_event_id;

    // 2. Romper la clave foránea poniendo a NULL el puntero en la tarea
    await db.query('UPDATE tasks SET scheduled_event_id = NULL WHERE id = $1', [id]);

    // 3. Si tenía evento en el calendario, eliminarlo
    if (eventId) {
      await db.query('DELETE FROM events WHERE id = $1', [eventId]);
    }

    // 4. Eliminar la tarea
    await db.query('DELETE FROM tasks WHERE id = $1', [id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Error al eliminar tarea:', err);
    res.status(500).json({ error: err.message });
  }
});

// Obtener métricas y distribución de horas por categoría
app.get('/api/analytics', async (req, res) => {
  try {
    const query = `
      SELECT 
        category,
        ROUND(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600)::numeric, 1) AS total_hours
      FROM events
      GROUP BY category;
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Iniciar servidor HTTP
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});
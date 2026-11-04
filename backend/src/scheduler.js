const db = require('./db');

async function autoScheduleTasks(userId = 1, startHour = 9, endHour = 20) {
  // Asegurar que son enteros
  startHour = parseInt(startHour, 10);
  endHour = parseInt(endHour, 10);

  // 1. Obtener tareas sin agendar ordenadas por urgencia
  const tasksRes = await db.query(
    `SELECT * FROM tasks 
     WHERE user_id = $1 AND scheduled_event_id IS NULL AND status != 'DONE' 
     ORDER BY priority DESC, due_date ASC`,
    [userId]
  );
  const pendingTasks = tasksRes.rows;

  if (pendingTasks.length === 0) return { message: 'No hay tareas pendientes por agendar.' };

  // 2. Obtener eventos existentes a partir de hoy
  const eventsRes = await db.query(
    `SELECT start_time, end_time FROM events 
     WHERE user_id = $1 AND end_time >= CURRENT_TIMESTAMP 
     ORDER BY start_time ASC`,
    [userId]
  );
  let occupiedSlots = eventsRes.rows.map(e => ({
    start: new Date(e.start_time),
    end: new Date(e.end_time)
  }));

  const scheduledEvents = [];

  // Puntero de búsqueda inicial
  let pointer = new Date();
  pointer.setMinutes(0, 0, 0);
  pointer.setHours(pointer.getHours() + 1);

  for (const task of pendingTasks) {
    const durationMs = (task.estimated_minutes || 60) * 60 * 1000;
    let placed = false;
    let daysChecked = 0;

    while (!placed && daysChecked < 14) {
      // Ajustar al rango de horas configurado por el usuario
      if (pointer.getHours() < startHour) {
        pointer.setHours(startHour, 0, 0, 0);
      } else if (pointer.getHours() >= endHour) {
        pointer.setDate(pointer.getDate() + 1);
        pointer.setHours(startHour, 0, 0, 0);
        daysChecked++;
        continue;
      }

      const slotStart = new Date(pointer);
      const slotEnd = new Date(slotStart.getTime() + durationMs);

      // Comprobar si el bloque calculado excede la hora de cierre del usuario
      if (slotEnd.getHours() > endHour || (slotEnd.getHours() === endHour && slotEnd.getMinutes() > 0)) {
        // Pasa al siguiente día a la hora de inicio configurada
        pointer.setDate(pointer.getDate() + 1);
        pointer.setHours(startHour, 0, 0, 0);
        daysChecked++;
        continue;
      }

      // Comprobar colisiones con eventos existentes
      const hasConflict = occupiedSlots.some(occ => {
        return (slotStart < occ.end && slotEnd > occ.start);
      });

      if (!hasConflict) {
        const newEvent = await db.query(
          `INSERT INTO events (user_id, title, description, start_time, end_time, color_hex, category)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [
            userId,
            `[Auto] ${task.title}`,
            `Bloque reservado para: ${task.title}`,
            slotStart,
            slotEnd,
            '#8b5cf6',
            'Enfoque'
          ]
        );

        const createdEvent = newEvent.rows[0];

        await db.query(
          `UPDATE tasks SET scheduled_event_id = $1, status = 'IN_PROGRESS' WHERE id = $2`,
          [createdEvent.id, task.id]
        );

        occupiedSlots.push({ start: slotStart, end: slotEnd });
        scheduledEvents.push(createdEvent);

        pointer = new Date(slotEnd);
        placed = true;
      } else {
        pointer = new Date(pointer.getTime() + 30 * 60 * 1000);
      }
    }
  }

  return { scheduled: scheduledEvents.length, events: scheduledEvents };
}

module.exports = { autoScheduleTasks };
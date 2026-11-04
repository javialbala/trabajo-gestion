let calendar;
let chartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
  initCalendar();
  loadData();
  setupTrashDropzone();
});

function initCalendar() {
  const calendarEl = document.getElementById('calendar');

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'timeGridWeek',
    firstDay: 1, // Lunes
    slotMinTime: '08:00:00',
    slotMaxTime: '22:00:00',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'timeGridWeek,dayGridMonth'
    },
    locale: 'es',
    allDaySlot: false,
    events: '/api/events',
    editable: true,
    droppable: true,

    // Mostrar notas al pasar el ratón por encima del evento
    eventDidMount: function(info) {
      if (info.event.extendedProps.description) {
        info.el.setAttribute('title', info.event.extendedProps.description);
      }
    },

    eventDrop: async (info) => {
      await updateEventDates(info.event.id, info.event.start, info.event.end || new Date(info.event.start.getTime() + 60 * 60 * 1000));
    },

    eventResize: async (info) => {
      await updateEventDates(info.event.id, info.event.start, info.event.end);
    },

    eventReceive: async (info) => {
      const taskId = info.draggedEl.getAttribute('data-task-id');
      const duration = parseInt(info.draggedEl.getAttribute('data-duration') || '60', 10);

      info.event.remove();

      if (taskId) {
        await scheduleTaskDirect(taskId, info.event.start, duration);
      }
    },

    eventDragStop: async (info) => {
      const trashEl = document.getElementById('calendar-trash');
      const trashRect = trashEl.getBoundingClientRect();
      const x = info.jsEvent.clientX;
      const y = info.jsEvent.clientY;

      if (x >= trashRect.left && x <= trashRect.right && y >= trashRect.top && y <= trashRect.bottom) {
        trashEl.classList.remove('bg-red-200', 'border-red-500', 'scale-105');
        await deleteEvent(info.event.id);
      }
    }
  });

  calendar.render();
}

function setupTrashDropzone() {
  const trashEl = document.getElementById('calendar-trash');

  trashEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    trashEl.classList.add('bg-red-200', 'border-red-500', 'scale-105');
  });

  trashEl.addEventListener('dragleave', () => {
    trashEl.classList.remove('bg-red-200', 'border-red-500', 'scale-105');
  });
}

function setupKanbanDraggables() {
  const containerEl = document.getElementById('col-todo');
  if (window.kanbanDraggableInstance) {
    window.kanbanDraggableInstance.destroy();
  }

  window.kanbanDraggableInstance = new FullCalendar.Draggable(containerEl, {
    itemSelector: '.draggable-task',
    eventData: function(eventEl) {
      return {
        title: eventEl.getAttribute('data-title'),
        duration: { minutes: parseInt(eventEl.getAttribute('data-duration') || '60', 10) }
      };
    }
  });
}

async function updateEventDates(eventId, start, end) {
  try {
    await fetch(`/api/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: start.toISOString(), end: end.toISOString() })
    });
  } catch (err) {
    console.error('Error actualizando fechas del evento:', err);
  }
}

async function scheduleTaskDirect(taskId, startDate, durationMinutes) {
  try {
    await fetch(`/api/tasks/${taskId}/schedule-direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: startDate.toISOString(), durationMinutes })
    });
    await loadData();
  } catch (err) {
    console.error('Error agendando tarea directamente:', err);
  }
}

async function deleteEvent(eventId) {
  try {
    const res = await fetch(`/api/events/${eventId}`, { method: 'DELETE' });
    await res.json();
    await loadData();
  } catch (err) {
    console.error('Error al eliminar evento:', err);
  }
}

async function loadData() {
  await loadTasks();
  if (calendar) {
    calendar.refetchEvents();
  }
}

async function loadTasks() {
  try {
    const res = await fetch('/api/tasks');
    const tasks = await res.json();

    document.getElementById('task-count').textContent = tasks.length;

    const colTodo = document.getElementById('col-todo');
    const colProgress = document.getElementById('col-progress');
    const colDone = document.getElementById('col-done');

    colTodo.innerHTML = '';
    colProgress.innerHTML = '';
    colDone.innerHTML = '';

    tasks.forEach(task => {
      const card = document.createElement('div');
      const isTodo = task.status === 'TODO';

      card.className = `bg-white p-3 rounded-lg border border-gray-200 shadow-sm text-sm hover:border-indigo-300 transition ${isTodo ? 'cursor-grab active:cursor-grabbing draggable-task' : ''}`;

      card.setAttribute('data-task-id', task.id);
      card.setAttribute('data-title', task.title);
      card.setAttribute('data-duration', task.estimated_minutes);

      const priorityColor = task.priority === 3 ? 'text-red-500 bg-red-50' : (task.priority === 2 ? 'text-yellow-600 bg-yellow-50' : 'text-gray-500 bg-gray-50');

      card.innerHTML = `
        <div class="flex justify-between items-start mb-1">
          <span class="font-semibold text-gray-800">${task.title}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded font-bold ${priorityColor}">P${task.priority}</span>
        </div>
        ${task.description ? `<p class="text-xs text-gray-600 mb-2 italic line-clamp-2 bg-gray-50 p-1.5 rounded">${task.description}</p>` : ''}
        <div class="flex justify-between items-center text-[11px] text-gray-500 mb-2">
          <span>🏷 ${task.category || 'General'}</span>
          <span>⏱ ${task.estimated_minutes} min</span>
        </div>
        <div class="flex justify-between items-center text-[11px] pt-1 border-t border-gray-100">
          <span class="text-gray-400">${new Date(task.due_date).toLocaleDateString()}</span>
          <div class="flex gap-2">
            ${task.status !== 'DONE' ? `
              <button onclick="markDone(${task.id})" class="text-indigo-600 hover:underline">Completar</button>
            ` : `
              <span class="text-emerald-600 font-semibold mr-1">Listo</span>
              <button onclick="deleteTask(${task.id})" class="text-red-500 hover:text-red-700 hover:underline">Eliminar</button>
            `}
          </div>
        </div>
      `;

      if (task.status === 'TODO') colTodo.appendChild(card);
      else if (task.status === 'IN_PROGRESS') colProgress.appendChild(card);
      else if (task.status === 'DONE') colDone.appendChild(card);
    });

    setupKanbanDraggables();
  } catch (err) {
    console.error('Error cargando tareas:', err);
  }
}

async function deleteTask(taskId) {
  try {
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    if (res.ok) {
      await loadData();
    }
  } catch (err) {
    console.error('Error al eliminar tarea:', err);
  }
}

async function autoSchedule() {
  const startVal = document.getElementById('scheduleStart').value || '09:00';
  const endVal = document.getElementById('scheduleEnd').value || '20:00';

  const startHour = parseInt(startVal.split(':')[0], 10);
  const endHour = parseInt(endVal.split(':')[0], 10);

  if (startHour >= endHour) {
    alert('La hora de inicio debe ser anterior a la hora de fin.');
    return;
  }

  try {
    const res = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startHour, endHour })
    });
    const result = await res.json();
    alert(result.message || `¡Completado! Se agendaron ${result.scheduled} tareas.`);
    await loadData();
  } catch (err) {
    alert('Error al ejecutar el agendado automático.');
  }
}

async function markDone(taskId) {
  await fetch(`/api/tasks/${taskId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'DONE' })
  });
  await loadData();
}

async function createTask(e) {
  e.preventDefault();
  const payload = {
    user_id: 1,
    title: document.getElementById('taskTitle').value,
    description: document.getElementById('taskDescription').value,
    category: document.getElementById('taskCategory').value,
    estimated_minutes: parseInt(document.getElementById('taskDuration').value, 10),
    priority: parseInt(document.getElementById('taskPriority').value, 10),
    due_date: new Date(document.getElementById('taskDueDate').value).toISOString()
  };

  await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  closeModal();
  document.getElementById('taskForm').reset();
  await loadData();
}

function openModal() {
  document.getElementById('taskModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('taskModal').classList.add('hidden');
}

// Analítica con Chart.js
async function openAnalyticsModal() {
  document.getElementById('analyticsModal').classList.remove('hidden');
  try {
    const res = await fetch('/api/analytics');
    const data = await res.json();

    const labels = data.map(d => d.category);
    const hours = data.map(d => parseFloat(d.total_hours));

    const ctx = document.getElementById('analyticsChart').getContext('2d');
    
    if (chartInstance) {
      chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels.length > 0 ? labels : ['Sin datos'],
        datasets: [{
          data: hours.length > 0 ? hours : [1],
          backgroundColor: [
            '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#6b7280'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
  } catch (err) {
    console.error('Error cargando analíticas:', err);
  }
}

function closeAnalyticsModal() {
  document.getElementById('analyticsModal').classList.add('hidden');
}
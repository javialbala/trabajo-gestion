CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    color_hex VARCHAR(7) DEFAULT '#3b82f6',
    category VARCHAR(50) DEFAULT 'General'
);

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    estimated_minutes INT DEFAULT 60,
    due_date TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'TODO', -- 'TODO', 'IN_PROGRESS', 'DONE'
    priority INT DEFAULT 1,             -- 1: Baja, 2: Media, 3: Alta
    scheduled_event_id INT REFERENCES events(id) ON DELETE SET NULL,
    description TEXT,
    category VARCHAR(50) DEFAULT 'Estudio'
);

-- Usuario y datos de prueba iniciales
INSERT INTO users (name, email) VALUES ('Javi', 'javi@uco.es') ON CONFLICT DO NOTHING;

INSERT INTO events (user_id, title, start_time, end_time, color_hex, category)
VALUES 
(1, 'Clase Redes', CURRENT_DATE + TIME '09:00:00', CURRENT_DATE + TIME '11:00:00', '#ef4444', 'Estudio'),
(1, 'Entrenamiento', CURRENT_DATE + TIME '18:00:00', CURRENT_DATE + TIME '19:30:00', '#10b981', 'Gimnasio');

INSERT INTO tasks (user_id, title, estimated_minutes, due_date, status, priority)
VALUES 
(1, 'Preparar memoria PaaS', 120, CURRENT_DATE + INTERVAL '2 days', 'TODO', 3),
(1, 'Revisar apuntes Kubernetes', 60, CURRENT_DATE + INTERVAL '3 days', 'IN_PROGRESS', 2);
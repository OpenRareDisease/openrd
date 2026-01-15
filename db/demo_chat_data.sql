-- Demo: FSHD Chat System Data Flow

-- 1. Check if user exists, if not create test user
INSERT INTO app_users (phone_number, password_hash, role) 
SELECT '13800138000', 'demo_password', 'patient'
WHERE NOT EXISTS (SELECT 1 FROM app_users WHERE phone_number = '13800138000');

-- 2. Create test session
INSERT INTO chat_sessions (user_id, title, session_type) 
SELECT id, 'Shoulder Pain Consultation', 'symptom' FROM app_users WHERE phone_number = '13800138000';

-- 3. Insert user message
WITH new_session AS (
    SELECT id FROM chat_sessions ORDER BY created_at DESC LIMIT 1
)
INSERT INTO chat_messages (session_id, role, content, has_medical_info) 
SELECT id, 'user', 'My right shoulder hurts a lot this week, especially when lifting arms', true FROM new_session;

-- 4. Insert AI response
WITH new_session AS (
    SELECT id FROM chat_sessions ORDER BY created_at DESC LIMIT 1
)
INSERT INTO chat_messages (session_id, role, content) 
SELECT id, 'assistant', 'Based on your description, this may be FSHD-related muscle fatigue. Advice: 1. Rest appropriately 2. Gentle stretching 3. Avoid heavy objects' FROM new_session;

-- 5. Simulate AI symptom extraction
WITH user_msg AS (
    SELECT m.id as msg_id, s.user_id 
    FROM chat_messages m 
    JOIN chat_sessions s ON m.session_id = s.id 
    WHERE m.role = 'user' 
    ORDER BY m.created_at DESC LIMIT 1
)
INSERT INTO patient_statements (user_id, message_id, statement_text, statement_type, body_part, severity, mentioned_date) 
SELECT user_id, msg_id, 'My right shoulder hurts a lot this week, especially when lifting arms', 'pain', 'shoulder', 7, CURRENT_DATE FROM user_msg;

-- 6. Show complete data flow
SELECT '=== Complete Data Flow Demo ===' as info;

SELECT 'Session Info:' as section, id, title, session_type 
FROM chat_sessions ORDER BY created_at DESC LIMIT 1;

SELECT 'Chat Messages:' as section, role, content 
FROM chat_messages 
WHERE session_id = (SELECT id FROM chat_sessions ORDER BY created_at DESC LIMIT 1)
ORDER BY created_at;

SELECT 'Symptom Extraction:' as section, statement_text, statement_type, body_part, severity, mentioned_date 
FROM patient_statements 
WHERE user_id = (SELECT user_id FROM chat_sessions ORDER BY created_at DESC LIMIT 1);

import { createClient } from '@supabase/supabase-js';

// The single, unified gateway for all API requests.
async function handleApiRequest(request, env) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
    const { action, payload, password } = await request.json();

    // --- Public Actions (No Auth Needed) ---
    if (action === 'init') {
        const { data: settingsArray } = await supabase.from('settings').select('*');
        const settings = settingsArray.reduce((obj, item) => ({ ...obj, [item.key]: item.value }), {});
        const { data: user, error } = await supabase.from('users').select('id').eq('name', 'Baba Ahmed').single();
        if (error) {
            const { data: newUser } = await supabase.from('users').insert({ name: 'Baba Ahmed' }).select('id').single();
            return { settings, user: newUser };
        }
        return { settings, user };
    }

    if (action === 'chat') {
        const { prompt, userId, settings } = payload;
        await supabase.from('messages').insert({ user_id: userId, sender: 'user', text: prompt });
        const fullPrompt = `Your identity is defined by these settings: ${JSON.stringify(settings)}. Respond as '${settings["mimo.name"]}' in Egyptian Arabic. The user said: "${prompt}"`;
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${env.GEMINI_API_KEY}`, {
            method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] })
        });
        if (!geminiResponse.ok) throw new Error('Gemini API Error');
        const geminiData = await geminiResponse.json();
        const mimoResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "مش عارفة أرد دلوقتي يا بابا.";
        await supabase.from('messages').insert({ user_id: userId, sender: 'mimo', text: mimoResponse });
        return { mimoResponse };
    }

    // --- Admin Actions (Auth Required) ---
    if (password !== env.ADMIN_PASSWORD) {
        throw new Error('Unauthorized');
    }

    if (action === 'login') {
        return { success: true };
    }

    if (action === 'admin_data') {
        const [{ data: settings }, { data: journal }, { data: memory }] = await Promise.all([
            supabase.from('settings').select('*'),
            supabase.from('journal').select('id, content').order('created_at', { ascending: false }),
            supabase.from('memory').select('id, content').order('created_at', { ascending: false })
        ]);
        return { settings, journal, memory };
    }

    if (action === 'save_settings') {
        const updates = Object.keys(payload).map(key => supabase.from('settings').update({ value: payload[key] }).eq('key', key));
        await Promise.all(updates);
        return { success: true };
    }

    if (action === 'delete_item') {
        await supabase.from(payload.table).delete().eq('id', payload.id);
        return { success: true };
    }

    throw new Error('Invalid action');
}

// --- Main Cloudflare Worker Entry Point ---
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api')) {
            try {
                const data = await handleApiRequest(request, env);
                return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
        }
        // Serve static assets (index.html, admin.html)
        return env.ASSETS.fetch(request);
    }
};

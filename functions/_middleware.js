// The Final, Simplified Gateway - functions/_middleware.js

import { createClient } from '@supabase/supabase-js';

// This function handles ALL requests to your site.
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // --- Route 1: API requests ---
        // If the URL path starts with /api, we know it's a special request.
        if (url.pathname.startsWith('/api')) {
            try {
                // Create the Supabase client once.
                const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
                const { action, payload, password } = await request.json();

                // --- Handle different actions ---

                // Action: 'init' (When the chat page loads)
                if (action === 'init') {
                    const { data: settingsArray } = await supabase.from('settings').select('*');
                    const settings = settingsArray.reduce((obj, item) => ({ ...obj, [item.key]: item.value }), {});
                    const { data: user, error } = await supabase.from('users').select('id').eq('name', 'Baba Ahmed').single();
                    if (error) { // Create user if not found
                        const { data: newUser } = await supabase.from('users').insert({ name: 'Baba Ahmed' }).select('id').single();
                        return new Response(JSON.stringify({ settings, user: newUser }), { headers: { 'Content-Type': 'application/json' } });
                    }
                    return new Response(JSON.stringify({ settings, user }), { headers: { 'Content-Type': 'application/json' } });
                }

                // Action: 'chat' (When user sends a message)
                if (action === 'chat') {
                    const { prompt, userId, settings } = payload;
                    await supabase.from('messages').insert({ user_id: userId, sender: 'user', text: prompt });
                    const fullPrompt = `Your identity is in these settings: ${JSON.stringify(settings)}. You are '${settings["mimo.name"]}'. Your personality: '${settings["mimo.personality"]}'. Respond in Egyptian Arabic. User said: "${prompt}"`;
                    
                    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${env.GEMINI_API_KEY}`, {
                        method: 'POST',
                        body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] })
                    });
                    
                    if (!geminiResponse.ok) throw new Error('Gemini API request failed');
                    const geminiData = await geminiResponse.json();
                    const mimoResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "مش عارفة أرد دلوقتي يا بابا.";
                    
                    await supabase.from('messages').insert({ user_id: userId, sender: 'mimo', text: mimoResponse });
                    return new Response(JSON.stringify({ mimoResponse }), { headers: { 'Content-Type': 'application/json' } });
                }

                // --- Admin Actions (Require Password) ---
                if (password !== env.ADMIN_PASSWORD) {
                    throw new Error('Unauthorized: Invalid Password');
                }

                if (action === 'login') {
                    return new Response(JSON.stringify({ success: true }));
                }

                if (action === 'admin_data') {
                    const [{ data: settings }, { data: journal }, { data: memory }] = await Promise.all([
                        supabase.from('settings').select('*'),
                        supabase.from('journal').select('id, content').order('created_at', { ascending: false }),
                        supabase.from('memory').select('id, content').order('created_at', { ascending: false })
                    ]);
                    return new Response(JSON.stringify({ settings, journal, memory }));
                }

                if (action === 'save_settings') {
                    const updates = Object.keys(payload).map(key => supabase.from('settings').update({ value: payload[key] }).eq('key', key));
                    await Promise.all(updates);
                    return new Response(JSON.stringify({ success: true }));
                }

                if (action === 'delete_item') {
                    await supabase.from(payload.table).delete().eq('id', payload.id);
                    return new Response(JSON.stringify({ success: true }));
                }

                // If action is not recognized
                throw new Error('Invalid API action');

            } catch (e) {
                // If any error happens in the API, return a clear error message.
                return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
        }
        
        // --- Route 2: Static Assets (HTML files) ---
        // If the URL is not for the API, then it must be a request for a file (like index.html or admin.html).
        // Let Cloudflare's default asset server handle it.
        return env.ASSETS.fetch(request);
    }
};

// The Final, Professionally-Reviewed Gateway - functions/_middleware.js
// This code incorporates best practices and direct solutions to the identified issues.

import { createClient } from '@supabase/supabase-js';

// --- Main Handler for All API Requests ---
async function handleApiRequest(request, env) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
    const { action, payload, password } = await request.json();

    // --- Action: 'init' (Public) ---
    // Fetches initial settings and user data for the chat interface.
    if (action === 'init') {
        const { data: settingsArray } = await supabase.from('settings').select('key, value, description');
        if (!settingsArray) throw new Error('Could not fetch settings from Supabase.');
        const settings = settingsArray.reduce((obj, item) => ({ ...obj, [item.key]: item.value }), {});
        
        const { data: user, error } = await supabase.from('users').select('id').eq('name', 'Baba Ahmed').single();
        if (error) { // If user doesn't exist, create one.
            const { data: newUser } = await supabase.from('users').insert({ name: 'Baba Ahmed' }).select('id').single();
            return { settings, user: newUser };
        }
        return { settings, user };
    }

    // --- Action: 'chat' (Public) ---
    // Handles a new message from the user and gets a response from Gemini.
    if (action === 'chat') {
        const { prompt, userId, settings } = payload;
        if (!prompt || !userId || !settings) throw new Error('Invalid chat payload.');
        
        await supabase.from('messages').insert({ user_id: userId, sender: 'user', text: prompt });
        
        const personality = settings['mimo.personality'] || 'a friendly assistant';
        const mimoName = settings['mimo.name'] || 'Mimo';
        const fullPrompt = `You are an AI assistant. Your name is ${mimoName}. Your personality is: "${personality}". You must respond in Egyptian Arabic. The user said: "${prompt}"`;
        
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${env.GEMINI_API_KEY}`, {
            method: 'POST',
            body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] })
        });
        
        if (!geminiResponse.ok) {
            console.error("Gemini API Error:", await geminiResponse.text());
            throw new Error('Failed to get a response from Gemini.');
        }
        
        const geminiData = await geminiResponse.json();
        const mimoResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "حصل خطأ بسيط، ممكن تجرب تاني يا بابا.";
        
        await supabase.from('messages').insert({ user_id: userId, sender: 'mimo', text: mimoResponse });
        return { mimoResponse };
    }

    // --- Admin Actions (Authentication Required from here) ---
    if (password !== env.ADMIN_PASSWORD) {
        throw new Error('Unauthorized: Invalid Password for admin action.');
    }

    if (action === 'login') {
        return { success: true };
    }

    if (action === 'admin_data') {
        const [{ data: settings }, { data: journal }, { data: memory }] = await Promise.all([
            supabase.from('settings').select('*').order('key'),
            supabase.from('journal').select('id, content').order('created_at', { ascending: false }),
            supabase.from('memory').select('id, content').order('created_at', { ascending: false })
        ]);
        return { settings, journal, memory };
    }

    if (action === 'save_settings') {
        const updates = Object.keys(payload).map(key => 
            supabase.from('settings').update({ value: payload[key] }).eq('key', key)
        );
        await Promise.all(updates);
        return { success: true };
    }

    if (action === 'delete_item') {
        await supabase.from(payload.table).delete().eq('id', payload.id);
        return { success: true };
    }

    // If no action matches
    throw new Error('Invalid API action provided.');
}

// --- Main Cloudflare Worker Entry Point ---
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Define CORS headers to allow your site to make requests.
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*', // In production, you might restrict this to your domain.
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // Handle CORS preflight requests. This is a standard requirement.
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // Handle API requests
        if (url.pathname.startsWith('/api')) {
            try {
                // We only allow POST requests to the API for simplicity and security.
                if (request.method !== 'POST') {
                    return new Response(JSON.stringify({ error: 'Only POST requests are accepted' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                const data = await handleApiRequest(request, env);
                return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            } catch (e) {
                console.error('API Error:', e);
                return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
        }
        
        // Handle static assets (index.html, admin.html, etc.)
        return env.ASSETS.fetch(request);
    }
};

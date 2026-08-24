/* Pilates con Jime — capa de datos compartida (app, panel y web).
   Requiere que supabase-js v2 esté cargado antes (window.supabase). */
(function () {
  const URL = 'https://ycpisxbeyikvtwyscvfi.supabase.co';
  const KEY = 'sb_publishable_Db9XawSUs7sf7a4_NI-UWw_i_s1KemS';

  const sb = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;

  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const PCJ = {
    sb,
    enabled: !!sb,

    /* ---------- catálogo de clases (lo define Jime) ---------- */
    CATALOG: [
      { name: 'Mat Flow', level: 'Principiante', duration: '50 min', modality: 'Grupal', price: '$25', capacity: 4, desc: 'Secuencia de suelo centrada en respiración y control del powerhouse. Ideal para empezar o volver después de una pausa.', img: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=600&auto=format&fit=crop' },
      { name: 'Slow Mat', level: 'Principiante', duration: '45 min', modality: 'Grupal', price: '$15', capacity: 5, desc: 'Ritmo pausado, mucha respiración y estiramiento. Buena para cerrar la semana.', img: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?q=80&w=600&auto=format&fit=crop' },
      { name: 'Centro y Postura', level: 'Intermedio', duration: '50 min', modality: 'Grupal', price: '$25', capacity: 4, desc: 'Clase pensada para quienes pasan el día sentadas: movilidad de columna, escápulas y activación profunda.', img: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?q=80&w=600&auto=format&fit=crop' },
      { name: 'Mat Privado', level: 'Intermedio', duration: '55 min', modality: 'Privada', price: '$40', capacity: 1, desc: 'Sesión uno a uno con corrección constante. Progresión con banda y magic circle, foco en cadena posterior.', img: 'https://images.unsplash.com/photo-1552196563-55cd4e45efb3?q=80&w=600&auto=format&fit=crop' },
      { name: 'Dúo Privado', level: 'Intermedio', duration: '50 min', modality: 'Dúo', price: '$30', capacity: 2, desc: 'Sesión para dos, con corrección individual. El formato más elegido por las alumnas.', img: 'https://images.unsplash.com/photo-1599901860904-17e6ed7083a0?q=80&w=600&auto=format&fit=crop' },
      { name: 'Mat Avanzado', level: 'Avanzado', duration: '55 min', modality: 'Privada', price: '$40', capacity: 2, desc: 'Transiciones fluidas y secuencias largas. Requiere control previo del repertorio intermedio.', img: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?q=80&w=600&auto=format&fit=crop' }
    ],
    classInfo(name) { return this.CATALOG.find(c => c.name === name) || this.CATALOG[0]; },
    // Foto y descripción genéricas para los horarios abiertos (ya no hay tipos de clase).
    SESSION_IMG: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=600&auto=format&fit=crop',

    /* ---------- sesión ---------- */
    async currentUser() {
      if (!sb) return null;
      const { data } = await sb.auth.getUser();
      return data ? data.user : null;
    },
    async signUp(email, password, profile) {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      const user = data.user;
      if (user) {
        // Si el proyecto pide confirmación por correo, la fila se crea igual al primer login.
        await sb.from('profiles').upsert({ id: user.id, email, ...profile });
      }
      return user;
    },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data.user;
    },
    async signOut() { if (sb) await sb.auth.signOut(); },

    /* ---------- perfil ---------- */
    async getProfile(id) {
      const { data } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
      return data;
    },
    async saveProfile(id, patch) {
      const { error } = await sb.from('profiles').upsert({ id, ...patch });
      if (error) throw error;
    },

    /* ---------- actividad de una alumna ---------- */
    async getActivity(userId) {
      const [r, b] = await Promise.all([
        sb.from('sessions').select('*').eq('user_id', userId).order('date', { ascending: false }),
        sb.from('bookings').select('*').eq('user_id', userId).in('status', ['pendiente', 'confirmada']).order('date')
      ]);
      const map = x => ({
        id: String(x.id), name: x.class_name, date: x.date, time: x.time,
        duration: x.duration, modality: x.modality, status: x.status
      });
      return { records: (r.data || []).map(map), bookings: (b.data || []).map(map) };
    },
    async createBooking(userId, b) {
      const { error } = await sb.from('bookings').insert({
        user_id: userId, date: b.date, time: b.time, class_name: b.name,
        modality: b.modality, duration: b.duration, status: 'pendiente'
      });
      if (error) throw error;
    },
    async cancelBooking(id) {
      await sb.from('bookings').update({ status: 'cancelada' }).eq('id', id);
    },

    /* ---------- disponibilidad ----------
       Jime está disponible siempre: la agenda se genera desde HOURS.
       Una hora deja de estar libre cuando ya hay una reserva (pendiente o
       confirmada) o cuando Jime la bloqueó desde el panel. */
    HOURS: ['7:00', '8:30', '10:00', '17:00', '18:30', '20:00'],
    SESSION: { name: 'Clase de Pilates', level: 'Todos los niveles', duration: '50 min', modality: 'A convenir', capacity: 1 },
    BLOCK: 'BLOQUEADO',

    async busySlots(from, to) {
      if (!sb) return [];
      const { data, error } = await sb.rpc('busy_slots', { d1: iso(from), d2: iso(to) });
      if (error) return [];
      return data || [];
    },
    async getSlots(from, to) {
      const busy = {};
      (await this.busySlots(from, to)).forEach(r => { busy[`${r.date} ${r.time}`] = r.kind; });
      const out = [];
      const now = new Date();
      const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      while (d <= end) {
        const date = iso(d);
        for (const time of this.HOURS) {
          const kind = busy[`${date} ${time}`];
          if (kind === 'bloqueo') continue;
          const hm = time.split(':').map(Number);
          if (new Date(d.getFullYear(), d.getMonth(), d.getDate(), hm[0], hm[1]) <= now) continue;
          const reservada = kind === 'reserva';
          out.push({
            id: `${date}-${time}`, date, time, ...this.SESSION,
            booked: reservada ? 1 : 0, free: reservada ? 0 : 1, taken: reservada
          });
        }
        d.setDate(d.getDate() + 1);
      }
      return out;
    },

    /* Horas cerradas a mano por Jime (se guardan en availability con class_name = BLOQUEADO) */
    async getBlocks(from, to) {
      const { data } = await sb.from('availability').select('date,time')
        .eq('class_name', this.BLOCK).gte('date', iso(from)).lte('date', iso(to));
      const out = {};
      (data || []).forEach(r => { (out[r.date] = out[r.date] || []).push(r.time); });
      return out;
    },
    async blockSlot(date, time) {
      const { error } = await sb.from('availability').insert({
        date, time, class_name: this.BLOCK, level: '—', duration: '—', modality: '—', capacity: 0
      });
      if (error) throw error;
    },
    async unblockSlot(date, time) {
      await sb.from('availability').delete().eq('date', date).eq('time', time).eq('class_name', this.BLOCK);
    },
    async blockDay(date) {
      await sb.from('availability').delete().eq('date', date).eq('class_name', this.BLOCK);
      const { error } = await sb.from('availability').insert(this.HOURS.map(t => ({
        date, time: t, class_name: this.BLOCK, level: '—', duration: '—', modality: '—', capacity: 0
      })));
      if (error) throw error;
    },
    async openDay(date) {
      await sb.from('availability').delete().eq('date', date).eq('class_name', this.BLOCK);
    },

    /* ---------- panel (solo admin) ---------- */
    async listStudents() {
      const [p, r, b] = await Promise.all([
        sb.from('profiles').select('*').order('created_at'),
        sb.from('sessions').select('*'),
        sb.from('bookings').select('*').in('status', ['pendiente', 'confirmada'])
      ]);
      const map = x => ({
        id: String(x.id), name: x.class_name, date: x.date, time: x.time,
        duration: x.duration, modality: x.modality, status: x.status, user_id: x.user_id
      });
      const recs = (r.data || []).map(map), books = (b.data || []).map(map);
      return (p.data || []).map(pr => ({
        id: pr.id, name: pr.name || 'Alumna', email: pr.email || '', phone: pr.phone || '',
        birth: pr.birth || '', level: pr.level || '', medical: pr.medical || '', plan: pr.plan || '',
        whatsappOptin: !!pr.whatsapp_optin, payment: pr.payment || '—',
        records: recs.filter(x => x.user_id === pr.id),
        bookings: books.filter(x => x.user_id === pr.id)
      }));
    },
    async setBookingStatus(id, status) {
      await sb.from('bookings').update({ status }).eq('id', id);
    },
    async markAttended(booking) {
      await sb.from('sessions').insert({
        user_id: booking.user_id, date: booking.date, time: booking.time,
        class_name: booking.name, duration: booking.duration, status: 'completada'
      });
      await sb.from('bookings').update({ status: 'completada' }).eq('id', booking.id);
    },
    async sendNotification(title, body, audience) {
      const { error } = await sb.from('notifications').insert({ title, body, audience });
      if (error) throw error;
    },
    /* ---------- avisos para la alumna ---------- */
    async inbox(userId) {
      const [n, r] = await Promise.all([
        sb.from('notifications').select('*').order('sent_at', { ascending: false }).limit(30),
        sb.from('notification_reads').select('notification_id').eq('user_id', userId)
      ]);
      const read = new Set((r.data || []).map(x => x.notification_id));
      return (n.data || []).map(x => ({
        id: x.id, title: x.title, body: x.body,
        sentAt: x.sent_at, unread: !read.has(x.id)
      }));
    },
    async markRead(userId, ids) {
      if (!ids.length) return;
      await sb.from('notification_reads').upsert(ids.map(id => ({ user_id: userId, notification_id: id })));
    },

    async sendFeedback(userId, name, message) {
      const { error } = await sb.from('feedback').insert({ user_id: userId, name, message });
      if (error) throw error;
    },
    async listFeedback() {
      const { data } = await sb.from('feedback').select('*').order('created_at', { ascending: false }).limit(20);
      return data || [];
    },

    async listNotifications() {
      const { data } = await sb.from('notifications').select('*').order('sent_at', { ascending: false }).limit(10);
      return data || [];
    }
  };

  window.PCJ = PCJ;
})();

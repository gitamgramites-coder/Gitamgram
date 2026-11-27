/* GITAMGRAM backend connector: real logins through Supabase Auth.
   Defines window.GITAMGRAM_API (see the comment above `const BE` in index.html).
   The publishable key below is meant to be public; security comes from Row Level Security in the database.
   NEVER put the service_role key in this file. */
(function () {
  "use strict";
  var URL = "https://xkumevmzkabixxymyrxz.supabase.co";
  var KEY = "sb_publishable_EmJhbsy5SOTpuYlJ7rnBjQ_V3O88Ngv";
  if (!window.supabase) { console.warn("GITAMGRAM: supabase-js did not load; sign-in is unavailable."); return; }
  var sb = window.supabase.createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  window.GITAMGRAM_SB = sb; // use this client for posts, stories, messages... (RLS protects every table)

  function msg(e) {
    var m = (e && e.message) || "Something went wrong. Try again.";
    if (/invalid login/i.test(m)) return "Incorrect email or password.";
    if (/not confirmed/i.test(m)) return "Confirm your email first. Use the 6-digit code we emailed you, or register again to get a new one.";
    if (/already (been )?registered/i.test(m)) return "That email is already registered. Try signing in.";
    if (/rate limit|too many/i.test(m)) return "Too many attempts. Please wait a few minutes and try again.";
    if (/database error saving new user/i.test(m)) return "Only GITAM university emails (@gitam.edu / @gitam.in) can register.";
    if (/token.*(expired|invalid)|expired|invalid.*token/i.test(m)) return "That code is incorrect or has expired.";
    return m;
  }
  function roleOf(p) {
    if (p.status !== "verified") return "student";
    return p.role === "super_admin" ? "super_admin" : p.role === "moderator" ? "admin" : "student";
  }
  function toUser(p, email) {
    return {
      id: p.id, name: p.display_name, un: p.username, email: email,
      campus: (p.campuses && p.campuses.slug) || "hyd", dept: p.department || "", year: p.academic_year || "",
      photo: p.avatar_url || null, bio: p.bio || "", status: p.status, verified: p.status === "verified",
      badge: !!p.has_badge, isOfficial: !!p.is_official, role: roleOf(p)
    };
  }
  async function loadProfile(uid) {
    var r = await sb.from("profiles").select("*, campuses(slug)").eq("id", uid).single();
    if (r.error) throw new Error(msg(r.error));
    return r.data;
  }

  window.GITAMGRAM_API = {
    login: async function (email, password) {
      var r = await sb.auth.signInWithPassword({ email: email, password: password });
      if (r.error) throw new Error(msg(r.error));
      var p = await loadProfile(r.data.user.id);
      if (p.status === "suspended") { await sb.auth.signOut(); throw new Error("This account is suspended. Contact the help desk."); }
      return { user: toUser(p, r.data.user.email), role: roleOf(p), mustChangePassword: !!p.must_change_password };
    },
    register: async function (o) {
      var r = await sb.auth.signUp({ email: o.email, password: o.password, options: { data: { name: o.name, campus: o.campus }, emailRedirectTo: location.origin } });
      if (r.error) throw new Error(msg(r.error));
      if (r.data.user && r.data.user.identities && r.data.user.identities.length === 0) throw new Error("That email is already registered. Try signing in.");
      return r.data;
    },
    verifyEmail: async function (email, code) {
      var r = await sb.auth.verifyOtp({ email: email, token: code, type: "signup" });
      if (r.error) throw new Error(msg(r.error));
      return r.data;
    },
    resendCode: async function (email) {
      var r = await sb.auth.resend({ type: "signup", email: email });
      if (r.error) throw new Error(msg(r.error));
    },
    submitVerification: async function (o) {
      var r = await sb.rpc("submit_verification", { p_student_id: o.sid, p_phone: o.phone, p_department: o.dept || null, p_year: o.year || null });
      if (r.error) {
        if (r.error.code === "23505") throw new Error("That student ID is already registered on this campus.");
        throw new Error(msg(r.error));
      }
    },
    changePassword: async function (oldPassword, newPassword) {
      var u = (await sb.auth.getUser()).data.user;
      if (!u) throw new Error("Please sign in again.");
      var chk = await sb.auth.signInWithPassword({ email: u.email, password: oldPassword });
      if (chk.error) throw new Error("Your current password is incorrect.");
      var r = await sb.auth.updateUser({ password: newPassword });
      if (r.error) throw new Error(msg(r.error));
    },
    forgotPassword: async function (email) {
      await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    },
    logout: async function () { await sb.auth.signOut(); }
  };

  /* Password-reset link lands here: show a small "choose a new password" dialog. */
  sb.auth.onAuthStateChange(function (ev) {
    if (ev !== "PASSWORD_RECOVERY") return;
    var wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif";
    var box = document.createElement("form");
    box.style.cssText = "background:#16161c;color:#fff;border-radius:16px;padding:20px;width:100%;max-width:340px;display:flex;flex-direction:column;gap:10px";
    var h = document.createElement("h3"); h.textContent = "Choose a new password"; h.style.margin = "0";
    var i = document.createElement("input"); i.type = "password"; i.minLength = 8; i.required = true; i.placeholder = "New password (min 8 characters)";
    i.style.cssText = "padding:12px;border-radius:10px;border:1px solid #333;background:#0d0d12;color:#fff";
    var e = document.createElement("div"); e.style.cssText = "color:#ff8a8a;font-size:13px;min-height:16px";
    var b = document.createElement("button"); b.textContent = "Save password"; b.style.cssText = "padding:12px;border:0;border-radius:10px;background:#14b8a6;color:#04201c;font-weight:700";
    box.append(h, i, e, b); wrap.appendChild(box); document.body.appendChild(wrap);
    box.addEventListener("submit", async function (ev2) {
      ev2.preventDefault();
      var r = await sb.auth.updateUser({ password: i.value });
      if (r.error) { e.textContent = msg(r.error); return; }
      await sb.auth.signOut(); wrap.remove(); history.replaceState(null, "", location.pathname);
      alert("Password updated. Please sign in with your new password.");
    });
  });
})();

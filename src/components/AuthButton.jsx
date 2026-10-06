import { useState } from "react";

export default function AuthButton({ user, onSignIn, onSignUp, onSignOut, onProfile }) {
  const [open, setOpen] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (isSignUp) {
      const { error } = await onSignUp(email, password);
      if (error) setError(error.message);
      else setMessage("Check your email to confirm your account!");
    } else {
      const { error } = await onSignIn(email, password);
      if (error) setError(error.message);
      else { setOpen(false); setEmail(""); setPassword(""); }
    }
  };

  const pill = {
    padding: "8px 18px", borderRadius: 999,
    border: "1.5px solid #ddd0c4", background: "white",
    fontFamily: "'Nunito'", fontWeight: 600, fontSize: 13,
    color: "#6b5544", cursor: "pointer",
    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
  };

  if (user) {
    return (
      <div style={{ display: "flex", justifyContent: "center", gap: 8,
        padding: "12px 16px 0", maxWidth: 440, margin: "0 auto" }}>
        <button onClick={onProfile}
          style={{ ...pill, display: "flex", alignItems: "center", gap: 6, flex: 1,
            justifyContent: "center" }}>
          <span style={{ fontSize: 14 }}>📊</span>
          My Progress
        </button>
        <button onClick={onSignOut}
          style={{ ...pill, display: "flex", alignItems: "center", gap: 6 }}>
          Sign out
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "12px 16px 0",
        maxWidth: 440, margin: "0 auto" }}>
        <button onClick={() => setOpen(true)} style={pill}>
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div onClick={() => setOpen(false)}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
        backdropFilter: "blur(4px)", display: "flex", alignItems: "center",
        justifyContent: "center", zIndex: 100, padding: 20 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}
        style={{ background: "white", borderRadius: 24, padding: "32px 28px",
          maxWidth: 340, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
          animation: "popIn 0.3s ease" }}>
        <h2 style={{ fontFamily: "'Nunito'", fontWeight: 800, fontSize: 22,
          color: "#3d2e1f", marginBottom: 4, textAlign: "center" }}>
          {isSignUp ? "Create Account" : "Welcome Back"}
        </h2>
        <p style={{ fontFamily: "'Crimson Pro'", fontSize: 14, color: "#a89585",
          textAlign: "center", marginBottom: 20 }}>
          {isSignUp ? "Sign up to save your progress" : "Sign in to access your starred words"}
        </p>

        <input type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} required
          style={{ width: "100%", padding: "12px 16px", borderRadius: 14,
            border: "1.5px solid #e0d5c8", fontFamily: "'Crimson Pro'", fontSize: 15,
            color: "#3d2e1f", outline: "none", marginBottom: 10,
            background: "#faf7f3" }} />

        <input type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)} required minLength={6}
          style={{ width: "100%", padding: "12px 16px", borderRadius: 14,
            border: "1.5px solid #e0d5c8", fontFamily: "'Crimson Pro'", fontSize: 15,
            color: "#3d2e1f", outline: "none", marginBottom: 14,
            background: "#faf7f3" }} />

        {error && (
          <p style={{ color: "#d4756b", fontSize: 13, fontFamily: "'Crimson Pro'",
            textAlign: "center", marginBottom: 10 }}>{error}</p>
        )}
        {message && (
          <p style={{ color: "#6b9e5a", fontSize: 13, fontFamily: "'Crimson Pro'",
            textAlign: "center", marginBottom: 10 }}>{message}</p>
        )}

        <button type="submit"
          style={{ width: "100%", padding: "12px", borderRadius: 999, border: "none",
            cursor: "pointer", fontFamily: "'Nunito'", fontWeight: 700, fontSize: 14,
            background: "linear-gradient(135deg, #c2956a, #a07048)", color: "white",
            boxShadow: "0 4px 16px rgba(160,112,72,0.3)" }}>
          {isSignUp ? "Sign Up" : "Sign In"}
        </button>

        <button type="button" onClick={() => { setIsSignUp(!isSignUp); setError(""); setMessage(""); }}
          style={{ display: "block", margin: "14px auto 0", background: "none",
            border: "none", cursor: "pointer", fontFamily: "'Crimson Pro'",
            fontSize: 13, color: "#9b8574" }}>
          {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>
      </form>
    </div>
  );
}

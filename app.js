import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

/* FIREBASE CONFIGURATION */
const firebaseConfig = {
  apiKey: "AIzaSyAn-2PdddXj-5T5-2swp7nFDbyOUkxeVMY",
  authDomain: "bloodsupport-f19fe.firebaseapp.com",
  projectId: "bloodsupport-f19fe",
  storageBucket: "bloodsupport-f19fe.firebasestorage.app",
  messagingSenderId: "421685314363",
  appId: "1:421685314363:web:7b928b64aa54b26296ed1e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);

const groups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

let currentUser = null;
let donors = [];
let requests = [];
let isRegisterMode = false;

$("year").textContent = new Date().getFullYear();

function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");

  setTimeout(() => {
    $("toast").classList.remove("show");
  }, 3000);
}

function message(id, text, success = false) {
  const el = $(id);

  if (!el) return;

  el.textContent = text;
  el.classList.toggle("success", success);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

function normalize(value = "") {
  return String(value).trim().toLowerCase();
}

function requireAuth() {
  if (!currentUser) {
    $("auth-dialog").showModal();
    toast("Please sign in first.");
    return false;
  }

  return true;
}

function errorText(e) {
  const map = {
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/email-already-in-use": "This email already has an account.",
    "auth/weak-password": "Use a password with at least 6 characters.",
    "auth/invalid-email": "Enter a valid email address.",
    "permission-denied": "Database access denied. Check Firestore rules."
  };

  return map[e?.code] || e?.message || "Something went wrong.";
}

/* DONOR CARD */

function donorCard(d) {
  const available = d.available !== false;

  const contact = currentUser
    ? `<a class="btn btn-light small-btn"
         href="tel:${escapeHtml(d.phone || "")}">
         Contact donor
       </a>`
    : `<button class="btn btn-light small-btn" data-signin>
         Sign in to contact
       </button>`;

  const ownerButton =
    currentUser && d.ownerId === currentUser.uid
      ? `<button
           class="btn btn-outline small-btn owner-toggle"
           data-id="${escapeHtml(d.id)}"
           data-available="${available}">
           ${available ? "Mark unavailable" : "Mark available"}
         </button>`
      : "";

  return `
    <article class="donor-card">
      <div class="donor-top">
        <div class="avatar">
          ${escapeHtml((d.name || "D").charAt(0).toUpperCase())}
        </div>

        <div>
          <h3>${escapeHtml(d.name || "Community donor")}</h3>
          <div class="muted">
            ${escapeHtml(d.city || "City not listed")}
          </div>
        </div>

        <span class="blood-badge">
          ${escapeHtml(d.bloodGroup || "—")}
        </span>
      </div>

      <div class="card-line"></div>

      <div class="card-bottom">
        <span class="availability ${available ? "" : "unavailable"}">
          ${available ? "● Available" : "● Unavailable"}
        </span>
        ${contact}
      </div>

      ${ownerButton}
    </article>
  `;
}

/* DISPLAY AND FILTER DONORS */

function renderDonors() {
  const group = $("search-group").value;
  const city = normalize($("search-city").value);
  const name = normalize($("search-name").value);

  const filtered = donors.filter(d =>
    (!group || d.bloodGroup === group) &&
    (!city || normalize(d.city).includes(city)) &&
    (!name || normalize(d.name).includes(name))
  );

  $("donor-count").textContent =
    `${filtered.length} donor${filtered.length === 1 ? "" : "s"} found`;

  $("donor-results").innerHTML = filtered.length
    ? filtered.map(donorCard).join("")
    : `<div class="empty-state">
         No donors match these filters.
       </div>`;

  $("donor-results").querySelectorAll("[data-signin]")
    .forEach(button => {
      button.addEventListener("click", () => {
        $("auth-dialog").showModal();
      });
    });

  $("donor-results").querySelectorAll(".owner-toggle")
    .forEach(button => {
      button.addEventListener("click", async () => {
        if (!requireAuth()) return;

        try {
          await updateDoc(
            doc(db, "donors", button.dataset.id),
            {
              available: button.dataset.available !== "true",
              updatedAt: serverTimestamp()
            }
          );

          await loadDonors();
          toast("Availability updated.");
        } catch (err) {
          toast(errorText(err));
        }
      });
    });
}

/* BLOOD REQUEST CARD */

function requestCard(r) {
  const owner = currentUser && r.ownerId === currentUser.uid;

  return `
    <article class="request-card">
      <div class="request-top">
        <div>
          <h3>
            ${escapeHtml(r.contactName || "Blood needed")}
            · ${escapeHtml(r.city || "")}
          </h3>

          <div class="muted">
            ${escapeHtml(r.hospital || "Hospital not listed")}
          </div>
        </div>

        <span class="urgency">
          ${escapeHtml(r.urgency || "Urgent")}
        </span>
      </div>

      <div class="request-details">
        <span>
          <strong>Blood group</strong>
          <b>${escapeHtml(r.bloodGroup || "—")}</b>
        </span>

        <span>
          <strong>Units needed</strong>
          <b>${escapeHtml(r.units || 1)}</b>
        </span>

        <span>
          <strong>Needed by</strong>
          <b>${escapeHtml(r.neededBy || "As soon as possible")}</b>
        </span>

        <span>
          <strong>Contact</strong>
          <b>${currentUser
            ? escapeHtml(r.phone || "Not listed")
            : "Sign in to view"}</b>
        </span>
      </div>

      ${r.details
        ? `<p class="muted">${escapeHtml(r.details)}</p>`
        : ""}

      <div class="request-footer">
        <span>
          ${r.status === "fulfilled"
            ? "✓ Fulfilled"
            : "● Open request"}
        </span>

        ${owner
          ? `<div>
               <button class="btn btn-light small-btn"
                 data-fulfill="${escapeHtml(r.id)}">
                 ${r.status === "fulfilled" ? "Reopen" : "Mark fulfilled"}
               </button>

               <button class="btn btn-outline small-btn"
                 data-delete="${escapeHtml(r.id)}">
                 Delete
               </button>
             </div>`
          : currentUser
            ? `<a class="btn btn-light small-btn"
                 href="tel:${escapeHtml(r.phone || "")}">
                 Call contact
               </a>`
            : `<button class="btn btn-light small-btn" data-signin>
                 Sign in
               </button>`}
      </div>
    </article>
  `;
}

/* DISPLAY REQUESTS */

function renderRequests() {
  const group = $("request-group").value;
  const city = normalize($("request-city").value);

  const filtered = requests.filter(r =>
    (!group || r.bloodGroup === group) &&
    (!city || normalize(r.city).includes(city))
  );

  $("request-results").innerHTML = filtered.length
    ? filtered.map(requestCard).join("")
    : `<div class="empty-state">No requests found.</div>`;

  $("request-results").querySelectorAll("[data-signin]")
    .forEach(button => {
      button.addEventListener("click", () => {
        $("auth-dialog").showModal();
      });
    });

  $("request-results").querySelectorAll("[data-fulfill]")
    .forEach(button => {
      button.addEventListener("click", async () => {
        try {
          await updateDoc(
            doc(db, "requests", button.dataset.fulfill),
            {
              status: button.textContent.trim() === "Reopen"
                ? "open"
                : "fulfilled",
              updatedAt: serverTimestamp()
            }
          );

          await loadRequests();
          toast("Request status updated.");
        } catch (err) {
          toast(errorText(err));
        }
      });
    });

  $("request-results").querySelectorAll("[data-delete]")
    .forEach(button => {
      button.addEventListener("click", async () => {
        if (!confirm("Delete this request?")) return;

        try {
          await deleteDoc(
            doc(db, "requests", button.dataset.delete)
          );

          await loadRequests();
          toast("Request deleted.");
        } catch (err) {
          toast(errorText(err));
        }
      });
    });
}

/* LOAD DATA FROM FIRESTORE */

async function loadDonors() {
  try {
    const snapshot = await getDocs(collection(db, "donors"));

    donors = snapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

    renderDonors();
  } catch (err) {
    $("donor-results").innerHTML =
      `<div class="empty-state">${escapeHtml(errorText(err))}</div>`;

    $("donor-count").textContent = "Could not load donors";
  }
}

async function loadRequests() {
  try {
    const snapshot = await getDocs(
      query(
        collection(db, "requests"),
        orderBy("createdAt", "desc")
      )
    );

    requests = snapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

    renderRequests();
  } catch (err) {
    $("request-results").innerHTML =
      `<div class="empty-state">${escapeHtml(errorText(err))}</div>`;
  }
}

/* LOGIN AND REGISTER */

$("login-btn").addEventListener("click", () => {
  isRegisterMode = false;
  updateAuthDialog();
  $("auth-dialog").showModal();
});

$("logout-btn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    toast("Signed out successfully.");
  } catch (err) {
    toast(errorText(err));
  }
});

function updateAuthDialog() {
  $("auth-title").textContent =
    isRegisterMode ? "Create account" : "Sign in";

  $("auth-submit").textContent =
    isRegisterMode ? "Create account" : "Sign in";

  $("auth-toggle").textContent =
    isRegisterMode
      ? "Already registered? Sign in"
      : "New here? Create an account";

  $("auth-form").elements.password.autocomplete =
    isRegisterMode ? "new-password" : "current-password";
}

$("auth-toggle").addEventListener("click", () => {
  isRegisterMode = !isRegisterMode;
  message("auth-message", "");
  updateAuthDialog();
});

$("auth-form").addEventListener("submit", async e => {
  e.preventDefault();

  const form = e.currentTarget; // FIX: capture before await

  const data = new FormData(form);
  const email = String(data.get("email") || "").trim();
  const password = String(data.get("password") || "");

  try {
    if (isRegisterMode) {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }

    $("auth-dialog").close();
    form.reset(); // FIXED
    message("auth-message", "", true);
    toast("You're signed in.");
  } catch (err) {
    message("auth-message", errorText(err));
  }
});

/* AUTH STATE */

onAuthStateChanged(auth, user => {
  currentUser = user;

  $("login-btn").classList.toggle("hidden", !!user);
  $("logout-btn").classList.toggle("hidden", !user);
  $("user-label").textContent = user ? user.email : "";

  renderDonors();
  renderRequests();
});

/* SEARCH CONTROLS */

$("search-btn").addEventListener("click", renderDonors);

$("clear-search").addEventListener("click", () => {
  $("search-group").value = "";
  $("search-city").value = "";
  $("search-name").value = "";
  renderDonors();
});

$("search-city").addEventListener("keydown", e => {
  if (e.key === "Enter") renderDonors();
});

$("search-name").addEventListener("keydown", e => {
  if (e.key === "Enter") renderDonors();
});

$("request-filter-btn").addEventListener("click", renderRequests);
$("request-group").addEventListener("change", renderRequests);

$("new-request-btn").addEventListener("click", () => {
  if (requireAuth()) {
    $("request-form-wrap").classList.remove("hidden");
  }
});

$("cancel-request").addEventListener("click", () => {
  $("request-form-wrap").classList.add("hidden");
});

/* SAVE DONOR PROFILE - FIXED */

$("donor-form").addEventListener("submit", async e => {
  e.preventDefault();

  const form = e.currentTarget; // FIX: save form reference before await

  if (!requireAuth()) return;

  const data = Object.fromEntries(new FormData(form).entries());

  if (!groups.includes(data.bloodGroup)) {
    message("donor-form-message", "Choose a valid blood group.");
    return;
  }

  try {
    const existing = donors.find(
      d => d.ownerId === currentUser.uid
    );

    const payload = {
      name: String(data.name || "").trim(),
      bloodGroup: data.bloodGroup,
      city: String(data.city || "").trim(),
      phone: String(data.phone || "").trim(),
      available: data.available === "true",
      ownerId: currentUser.uid,
      updatedAt: serverTimestamp()
    };

    if (existing) {
      await updateDoc(
        doc(db, "donors", existing.id),
        payload
      );
    } else {
      await addDoc(
        collection(db, "donors"),
        {
          ...payload,
          createdAt: serverTimestamp()
        }
      );
    }

    form.reset(); // FIXED: no e.currentTarget after await

    message(
      "donor-form-message",
      "Your donor profile has been saved.",
      true
    );

    await loadDonors();
    toast("Donor profile saved successfully!");

  } catch (err) {
    message("donor-form-message", errorText(err));
  }
});

/* SAVE BLOOD REQUEST - FIXED */

$("request-form").addEventListener("submit", async e => {
  e.preventDefault();

  const form = e.currentTarget; // FIX: save form reference before await

  if (!requireAuth()) return;

  const data = Object.fromEntries(new FormData(form).entries());

  if (!groups.includes(data.bloodGroup)) {
    message("request-form-message", "Choose a valid blood group.");
    return;
  }

  try {
    await addDoc(collection(db, "requests"), {
      contactName: String(data.contactName || "").trim(),
      bloodGroup: data.bloodGroup,
      city: String(data.city || "").trim(),
      units: Number(data.units),
      hospital: String(data.hospital || "").trim(),
      neededBy: data.neededBy,
      phone: String(data.phone || "").trim(),
      urgency: data.urgency,
      details: String(data.details || "").trim(),
      status: "open",
      ownerId: currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    form.reset(); // FIXED
    message(
      "request-form-message",
      "Your blood request has been published.",
      true
    );

    $("request-form-wrap").classList.add("hidden");

    await loadRequests();
    toast("Blood request published.");

  } catch (err) {
    message("request-form-message", errorText(err));
  }
});

/* INITIAL LOAD */

loadDonors();
loadRequests();

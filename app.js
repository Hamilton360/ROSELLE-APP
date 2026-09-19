import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  "https://zazqpuanjoxpnglqwuoc.supabase.co",
  "sb_publishable_FTgIJ4cbLk6we0_ZaCyMig_lJxNe9Cd"
);

const $ = (s, root = document) => root.querySelector(s);
const views = {
  landing: $("#landingView"),
  auth: $("#authView"),
  student: $("#studentView"),
  teacher: $("#teacherView"),
  dashboard: $("#dashboardView"),
  guide: $("#guideView")
};

let selectedRole = "";
let session = null;
let actualRole = "";
let dashboardRows = [];
let dashboardLoadedAt = null;
let teacherStudent = null;
let activeTicket = null;

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[c]));

const fmt = d => d
  ? new Date(d).toLocaleString([], { dateStyle:"medium", timeStyle:"short" })
  : "—";

const dateOnly = d => d
  ? new Date(d + (String(d).includes("T") ? "" : "T00:00:00")).toLocaleDateString()
  : "—";

const statusClass = s => ({
  Pending:"pending",
  "Sent to Outsource Repair":"outsource",
  "In House Repair":"repair",
  "Device Ready":"ready",
  Completed:"complete"
}[s] || "pending");

const badge = s =>
  '<span class="badge ' + statusClass(s) + '">' + esc(s || "Pending") + "</span>";

const show = name => {
  Object.values(views).forEach(v => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
  scrollTo(0, 0);
};

const toast = message => {
  const t = $("#toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
};

const roleFromSession = s =>
  String(s?.user?.app_metadata?.role || s?.user?.user_metadata?.role || "").toLowerCase();

const schoolFromSession = s =>
  String(s?.user?.app_metadata?.school || s?.user?.user_metadata?.school || "").trim();

function setConnection(ok, message = "") {
  $("#connectionStatus").innerHTML = ok
    ? '<i></i> Backend connected'
    : '<i class="bad"></i> ' + esc(message || "Backend unavailable");
}

async function checkBackend() {
  const r = await supabase.from("app_records").select("id", { count:"exact", head:true });
  setConnection(!r.error, r.error?.message);
}
checkBackend();

function auth(role) {
  selectedRole = role;
  $("#authTitle").textContent =
    role === "techteam" ? "TechTeam sign in" :
    role === "admin" ? "Admin sign in" :
    role === "teacher" ? "Teacher / Staff sign in" : "Student sign in";

  $("#authCopy").textContent =
    role === "student"
      ? "Sign in with your authorized student account."
      : role === "teacher"
        ? "Use your authorized staff account."
        : "Use your authorized operations account to continue.";

  $("#authError").textContent = "";
  show("auth");
}

function roleAllowed(selected, actual) {
  if (!actual) return false;
  if (selected === actual) return true;
  if (selected === "teacher" && ["teacher","staff"].includes(actual)) return true;
  return false;
}

document.querySelectorAll("[data-role]").forEach(b => b.onclick = () => auth(b.dataset.role));
document.querySelectorAll("[data-back]").forEach(b => b.onclick = () => show("landing"));
$("#backHome").onclick = () => show("landing");
$("#openGuide").onclick = () => show("guide");

$("#signOutBtn").onclick = async () => {
  await supabase.auth.signOut();
  session = null;
  actualRole = "";
  $("#signOutBtn").classList.add("hidden");
  show("landing");
};

$("#authForm").onsubmit = async e => {
  e.preventDefault();
  $("#authError").textContent = "Signing in…";

  const r = await supabase.auth.signInWithPassword({
    email: $("#email").value.trim(),
    password: $("#password").value
  });

  if (r.error) {
    $("#authError").textContent = r.error.message;
    return;
  }

  session = r.data.session;
  actualRole = roleFromSession(session);

  if (!roleAllowed(selectedRole, actualRole)) {
    await supabase.auth.signOut();
    session = null;
    actualRole = "";
    $("#authError").textContent =
      "This account is not configured for the selected VILS role. Contact a VILS administrator.";
    return;
  }

  $("#signOutBtn").classList.remove("hidden");

  if (actualRole === "student") show("student");
  else if (["teacher","staff"].includes(actualRole)) show("teacher");
  else await loadDashboard();
};

async function lookupStudent(id) {
  const normalized = String(id).trim();
  if (!normalized) throw new Error("Enter a Student ID.");
  const r = await supabase.rpc("lookup_student", { p_student_id: normalized });
  if (r.error || !r.data?.length) {
    throw new Error(r.error?.message || "No matching student found.");
  }
  return r.data[0];
}

function studentCard(s) {
  return '<strong>' + esc(s.student_name || "Student") + '</strong>' +
    '<div class="student-meta">' +
    '<span>' + esc(s.school || "School unavailable") + '</span>' +
    '<span>ID: ' + esc(s.student_id) + '</span>' +
    '<span>Asset: ' + esc(s.asset_tag || "Not available") + '</span>' +
    '<span>Serial: ' + esc(s.device_serial || "Not available") + '</span>' +
    '<span>Type: ' + esc(s.device_type || "Not available") + '</span>' +
    '</div>';
}

function otherIssueField() {
  return '<label id="otherIssueWrap" class="hidden">Additional issue details' +
    '<textarea name="other_issue_description" rows="4" placeholder="Explain the issue in your own words."></textarea></label>';
}

function repairFields(prefix = "") {
  return '<label>Reason<select name="repair_reason" id="' + prefix + 'repairReason" required>' +
    '<option value="">Select one</option>' +
    '<option>Cracked Screen</option><option>Keyboard Issue</option>' +
    '<option>Trackpad Repair</option><option>Won\'t Power On</option>' +
    '<option>Battery Issue</option><option>Charging Port</option>' +
    '<option>Software Issue</option><option>Other</option>' +
    '</select></label>' + otherIssueField();
}

function bindRepairReason(root) {
  const select = $("#repairReason", root);
  const wrap = $("#otherIssueWrap", root);
  if (!select || !wrap) return;
  select.onchange = () => {
    wrap.classList.toggle("hidden", select.value !== "Other");
    const ta = $('textarea[name="other_issue_description"]', root);
    if (ta) ta.required = select.value === "Other";
  };
}

function combineIssue(fd) {
  const reason = fd.get("repair_reason") || "";
  const description = String(fd.get("issue_description") || "").trim();
  const other = String(fd.get("other_issue_description") || "").trim();
  if (reason === "Other" && other) return description ? description + "\n\nOther details: " + other : other;
  return description;
}

document.querySelectorAll("[data-service]").forEach(b => b.onclick = () => studentForm(b.dataset.service));

function studentForm(type) {
  const wrap = $("#studentFormWrap");

  wrap.innerHTML =
    '<form id="studentForm" class="form-card service-form">' +
    '<div class="student-result" id="studentResult"><strong>Student lookup</strong>' +
    '<div class="student-meta"><span>Enter your Student ID to load your roster/device information.</span></div></div>' +
    '<label>Student ID<input id="studentId" required inputmode="numeric" placeholder="Enter Student ID"></label>' +
    '<button type="button" class="ghost-btn" id="lookupBtn">Lookup student</button>' +
    '<div id="dynamicFields"></div>' +
    '<button class="primary-btn" id="submitStudentBtn" type="submit" disabled>Submit request <span>→</span></button>' +
    '<p id="studentMsg" class="form-msg"></p></form>';

  let loaded = null;
  let submitting = false;

  $("#lookupBtn").onclick = async () => {
    const id = $("#studentId").value.trim();
    if (!id) return;

    $("#studentMsg").textContent = "Looking up…";
    $("#lookupBtn").disabled = true;

    try {
      loaded = await lookupStudent(id);
      $("#studentForm").dataset.studentId = loaded.student_id;
      $("#studentResult").innerHTML = studentCard(loaded);

      let f = "";
      if (type === "ticket") {
        f = repairFields() +
          '<label>Describe the issue<textarea name="issue_description" rows="4" required placeholder="Include useful details."></textarea></label>';
      } else if (type === "lost") {
        f =
          '<label>Last known room<input name="last_known_room" required></label>' +
          '<label>Last known class / period<input name="last_known_class_period" required></label>' +
          '<label>What happened?<textarea name="case_description" rows="5" required placeholder="Tell us when and where you last had the device."></textarea></label>' +
          '<label>Device identifying features<textarea name="device_identifying_features" rows="5" required placeholder="Case, stickers, scratches, labels, or other identifying details."></textarea></label>';
      } else {
        f =
          '<div class="student-result"><strong>Day loaner request</strong>' +
          '<div class="student-meta"><span>Your request will be linked to this student record. TechTeam will handle assignment.</span></div></div>';
      }

      $("#dynamicFields").innerHTML = f;
      bindRepairReason($("#dynamicFields"));
      $("#submitStudentBtn").disabled = false;
      $("#studentMsg").textContent = "";
    } catch (err) {
      loaded = null;
      $("#studentMsg").textContent = err.message;
      $("#submitStudentBtn").disabled = true;
    } finally {
      $("#lookupBtn").disabled = false;
    }
  };

  $("#studentForm").onsubmit = async e => {
    e.preventDefault();
    if (submitting || !loaded) return;

    const id = e.currentTarget.dataset.studentId;
    const fd = new FormData(e.currentTarget);
    let fn, args;

    if (type === "ticket") {
      fn = "create_student_ticket";
      args = {
        p_student_id: id,
        p_repair_reason: fd.get("repair_reason"),
        p_issue_description: combineIssue(fd),
        p_submitted_by_role: "student",
        p_teacher_name: null,
        p_teacher_room_or_period: null
      };
    } else if (type === "lost") {
      fn = "create_lost_device_report";
      args = {
        p_student_id: id,
        p_last_known_room: fd.get("last_known_room"),
        p_last_known_class_period: fd.get("last_known_class_period"),
        p_case_description: fd.get("case_description"),
        p_device_identifying_features: fd.get("device_identifying_features")
      };
    } else {
      fn = "create_day_loaner_request";
      args = { p_student_id: id };
    }

    submitting = true;
    $("#submitStudentBtn").disabled = true;
    $("#lookupBtn").disabled = true;
    $("#studentMsg").textContent = "Submitting…";

    const r = await supabase.rpc(fn, args);

    if (r.error) {
      submitting = false;
      $("#submitStudentBtn").disabled = false;
      $("#studentMsg").textContent = r.error.message;
      return;
    }

    toast((r.data?.ticket_id || "Request") + " submitted");
    $("#studentMsg").textContent = "Submitted successfully.";
  };
}

document.querySelectorAll('input[name="ticket_type"]').forEach(r => r.onchange = () => {
  const student = r.value === "student";
  $("#teacherStudentFields").classList.toggle("hidden", !student);
  $("#teacherDeviceFields").classList.toggle("hidden", student);
  $("#teacherStudentId").required = student;
});

$("#teacherRepairReason").onchange = () => {
  const other = $("#teacherRepairReason").value === "Other";
  $("#teacherOtherIssueWrap").classList.toggle("hidden", !other);
  const field = $('textarea[name="other_issue_description"]', $("#teacherForm"));
  if (field) field.required = other;
};

$("#teacherLookup").onclick = async () => {
  const id = $("#teacherStudentId").value.trim();
  if (!id) return;
  $("#teacherLookup").disabled = true;
  $("#teacherStudentResult").textContent = "Looking up…";

  try {
    teacherStudent = await lookupStudent(id);
    $("#teacherStudentResult").innerHTML = studentCard(teacherStudent);
  } catch (e) {
    teacherStudent = null;
    $("#teacherStudentResult").textContent = e.message;
  } finally {
    $("#teacherLookup").disabled = false;
  }
};

$("#teacherForm").onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  const type = f.get("ticket_type");

  if (type === "student" && !teacherStudent) {
    $("#teacherMsg").textContent = "Look up a student before submitting.";
    return;
  }

  $("#teacherMsg").textContent = "Submitting…";
  const submit = e.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;

  const r = type === "student"
    ? await supabase.rpc("create_student_ticket", {
        p_student_id: teacherStudent.student_id,
        p_repair_reason: f.get("repair_reason"),
        p_issue_description: combineIssue(f),
        p_submitted_by_role: "teacher",
        p_teacher_name: f.get("teacher_name"),
        p_teacher_room_or_period: f.get("room_or_period")
      })
    : await supabase.rpc("create_teacher_device_ticket", {
        p_teacher_name: f.get("teacher_name"),
        p_school: f.get("school"),
        p_device_serial: f.get("device_serial"),
        p_asset_tag: f.get("asset_tag"),
        p_room_or_period: f.get("room_or_period"),
        p_repair_reason: f.get("repair_reason"),
        p_issue_description: combineIssue(f)
      });

  if (r.error) {
    submit.disabled = false;
    $("#teacherMsg").textContent = r.error.message;
    return;
  }

  toast((r.data?.ticket_id || "Request") + " submitted");
  $("#teacherMsg").textContent = "Request submitted successfully.";
  e.currentTarget.reset();
  teacherStudent = null;
  $("#teacherStudentResult").textContent = "No student loaded.";
  document.querySelector('input[value="student"]').dispatchEvent(new Event("change"));
  $("#teacherOtherIssueWrap").classList.add("hidden");
  const otherField = $('textarea[name="other_issue_description"]', e.currentTarget);
  if (otherField) otherField.required = false;
  submit.disabled = false;
};

function ensureDashboardTools() {
  if ($("#dashboardTools")) return;

  const nav = $(".dash-nav");
  nav.insertAdjacentHTML("beforeend",
    '<button class="nav-card" data-panel="dayrequests"><b>07</b><strong>Day requests</strong><span>Temporary device queue</span></button>' +
    '<button class="nav-card" data-panel="members"><b>08</b><strong>Members</strong><span>TechTeam access</span></button>' +
    '<button class="nav-card" data-panel="reports"><b>09</b><strong>Reports</strong><span>Admin metrics</span></button>' +
    '<button class="nav-card" data-panel="maintenance"><b>10</b><strong>Maintenance</strong><span>System checks</span></button>'
  );

  const dash = $("#dashboardView");
  dash.insertAdjacentHTML("beforeend",
    '<div id="dashboardTools">' +
      '<div id="dashDayrequests" class="dash-panel hidden"><div class="table-card">' +
        '<div class="table-head"><div><h2>Day-loaner requests</h2><p>Requests waiting for TechTeam handling.</p></div>' +
        '<button class="ghost-btn" id="refreshRequests">Refresh</button></div>' +
        '<div class="table-scroll"><table><thead><tr><th>Student</th><th>ID</th><th>School</th><th>Created</th><th>Action</th></tr></thead><tbody id="dayRequestRows"></tbody></table></div>' +
      '</div></div>' +

      '<div id="dashMembers" class="dash-panel hidden"><div class="table-card">' +
        '<div class="table-head"><div><h2>TechTeam members</h2><p>Admin-only membership management.</p></div>' +
        '<button class="primary-btn compact-btn" id="addMemberBtn">Add member <span>+</span></button></div>' +
        '<div class="table-scroll"><table><thead><tr><th>Name</th><th>Student ID</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody id="memberRows"></tbody></table></div>' +
      '</div></div>' +

      '<div id="dashReports" class="dash-panel hidden"><div class="table-card">' +
        '<div class="table-head"><div><h2>Operations report</h2><p>Current database counts. Admin access required.</p></div>' +
        '<button class="ghost-btn" id="refreshReport">Refresh report</button></div>' +
        '<div id="reportBody" class="report-grid"><div class="empty">Load report to view metrics.</div></div>' +
      '</div></div>' +

      '<div id="dashMaintenance" class="dash-panel hidden"><div class="table-card">' +
        '<div class="table-head"><div><h2>Maintenance</h2><p>Application and data integrity checks.</p></div></div>' +
        '<div id="maintenanceBody" class="maintenance-list"></div>' +
      '</div></div>' +
    '</div>' +
    '<div id="recordModal" class="modal hidden" role="dialog" aria-modal="true" aria-label="Record editor"></div>'
  );

  document.querySelectorAll(".nav-card").forEach(b => b.onclick = () => activatePanel(b.dataset.panel));
  $("#refreshRequests").onclick = renderDayRequests;
  $("#refreshReport").onclick = loadReport;
  $("#addMemberBtn").onclick = () => openMemberModal();

  // Loaner inventory is managed from the existing Loaners panel.
  const loanerHead = $("#dashLoaners .table-head");
  if (loanerHead && !$("#addLoanerBtn")) {
    loanerHead.insertAdjacentHTML("beforeend", '<button class="primary-btn compact-btn" id="addLoanerBtn">Add loaner <span>+</span></button>');
    $("#addLoanerBtn").onclick = () => openLoanerModal();
  }

  // Members and reporting are administrator-only controls.
  if (actualRole !== "admin") {
    document.querySelectorAll('[data-panel="members"],[data-panel="reports"]').forEach(b => b.classList.add("hidden"));
  }
}

function activatePanel(name) {
  const target = $("#dash" + name[0].toUpperCase() + name.slice(1));
  if (!target) return;

  document.querySelectorAll(".dash-panel").forEach(x => x.classList.add("hidden"));
  target.classList.remove("hidden");
  document.querySelectorAll(".nav-card").forEach(x =>
    x.classList.toggle("active", x.dataset.panel === name)
  );

  if (name === "dayrequests") renderDayRequests();
  if (name === "members") renderMembers();
  if (name === "reports") loadReport();
  if (name === "maintenance") renderMaintenance();
}

document.querySelectorAll(".nav-card").forEach(b => b.onclick = () => activatePanel(b.dataset.panel));
$("#jumpTickets").onclick = () => activatePanel("tickets");

async function loadDashboard() {
  show("dashboard");
  ensureDashboardTools();
  $("#dashRole").textContent = (actualRole || selectedRole).toUpperCase();

  const r = await supabase
    .from("app_records")
    .select("*")
    .in("record_type", ["ticket","lost_device_report","loaner","activity","day_loaner_request","techteam_member"])
    .order("created_at", { ascending:false });

  if (r.error) {
    $("#ticketRows").innerHTML =
      '<tr><td colspan="5" class="empty">' + esc(r.error.message) + "</td></tr>";
    return;
  }

  dashboardRows = r.data || [];
  dashboardLoadedAt = new Date();

  const tickets = dashboardRows.filter(x => x.record_type === "ticket");
  const loaners = dashboardRows.filter(x => x.record_type === "loaner");
  const lost = dashboardRows.filter(x => x.record_type === "lost_device_report");
  const activity = dashboardRows.filter(x => x.record_type === "activity");

  $("#openCount").textContent = tickets.filter(x => x.status !== "Completed").length;
  $("#loanerCount").textContent = loaners.filter(x => x.loaner_status === "In Use").length;
  $("#lostCount").textContent = lost.length;
  $("#activityCount").textContent = activity.length;
  $("#reminderText").textContent =
    tickets.filter(x => x.status !== "Completed").length + " ticket(s) still need attention.";

  renderTickets();
  renderLoaners(loaners);
  renderShipping(tickets);
  renderLost(lost);
  renderActivity(activity);
  renderMaintenance();
}

function renderTickets() {
  const filter = $("#ticketStatusFilter").value;
  const sort = $("#ticketSort").value;

  let rows = dashboardRows.filter(x =>
    x.record_type === "ticket" && (filter === "all" || x.status === filter)
  );

  rows.sort((a,b) =>
    sort === "asc"
      ? new Date(a.created_at) - new Date(b.created_at)
      : new Date(b.created_at) - new Date(a.created_at)
  );

  $("#ticketRows").innerHTML = rows.slice(0, 75).map(x =>
    '<tr class="clickable-row" data-ticket="' + esc(x.ticket_id || "") + '">' +
      '<td><strong>' + esc(x.ticket_id || "—") + '</strong></td>' +
      '<td>' + esc(x.student_name || x.teacher_name || "—") +
        '<small>' + esc(x.student_id || x.teacher_room_or_period || "") + '</small></td>' +
      '<td>' + esc(x.repair_reason || "—") + '</td>' +
      '<td>' + badge(x.status) + '</td>' +
      '<td>' + fmt(x.created_at) + '</td>' +
    '</tr>'
  ).join("") || '<tr><td colspan="5" class="empty">No tickets match this filter.</td></tr>';

  document.querySelectorAll("[data-ticket]").forEach(row =>
    row.onclick = () => openTicketModal(row.dataset.ticket)
  );
}

function renderLoaners(rows) {
  $("#loanerRows").innerHTML = rows.map(x =>
    '<tr class="clickable-row" data-loaner="' + esc(x.loaner_serial || "") + '">' +
      '<td>' + esc(x.loaner_serial || "—") + '</td>' +
      '<td>' + esc(x.loaner_type || "—") + '</td>' +
      '<td>' + badge(x.loaner_status || "Available") + '</td>' +
      '<td>' + esc(x.assigned_student_name || "—") + '</td>' +
      '<td>' + esc(x.assigned_to_ticket || "—") + '</td>' +
    '</tr>'
  ).join("") || '<tr><td colspan="5" class="empty">No loaners recorded.</td></tr>';

  document.querySelectorAll("[data-loaner]").forEach(row =>
    row.onclick = () => openLoanerModal(row.dataset.loaner)
  );
}

function renderShipping(rows) {
  const x = rows.filter(r => r.shipping_vendor || r.tracking_number || r.shipping_date);
  $("#shippingRows").innerHTML = x.map(r =>
    '<tr class="clickable-row" data-ticket="' + esc(r.ticket_id || "") + '">' +
      '<td>' + esc(r.ticket_id || "—") + '</td>' +
      '<td>' + esc(r.shipping_vendor || "—") + '</td>' +
      '<td>' + esc(r.tracking_number || "—") + '</td>' +
      '<td>' + esc(r.shipping_date || "—") + '</td>' +
      '<td>' + esc(r.expected_return_date || "—") + '</td>' +
    '</tr>'
  ).join("") || '<tr><td colspan="5" class="empty">No outsourced shipping records.</td></tr>';

  document.querySelectorAll("#shippingRows [data-ticket], #shippingRows tr[data-ticket]").forEach(row =>
    row.onclick = () => openTicketModal(row.dataset.ticket)
  );
}

function renderLost(rows) {
  $("#lostRows").innerHTML = rows.map(x =>
    '<tr><td>' + esc(x.student_name || "—") + '</td>' +
    '<td>' + esc(x.student_id || "—") + '</td>' +
    '<td>' + esc(x.last_known_room || "—") + '</td>' +
    '<td>' + esc(x.last_known_class_period || "—") + '</td>' +
    '<td>' + esc(x.status || "Reported") + '</td></tr>'
  ).join("") || '<tr><td colspan="5" class="empty">No lost-device reports.</td></tr>';
}

function renderActivity(rows) {
  $("#activityRows").innerHTML = rows.slice(0, 75).map(x =>
    '<tr><td>' + esc(x.action_type || "—") + '</td>' +
    '<td>' + esc(x.action_description || "—") + '</td>' +
    '<td>' + esc(x.performed_by_name || x.performed_by || "—") + '</td>' +
    '<td>' + fmt(x.action_time || x.created_at) + '</td></tr>'
  ).join("") || '<tr><td colspan="4" class="empty">No activity recorded.</td></tr>';
}

function renderDayRequests() {
  const rows = dashboardRows.filter(x => x.record_type === "day_loaner_request");
  $("#dayRequestRows").innerHTML = rows.map(x =>
    '<tr>' +
      '<td>' + esc(x.student_name || "—") + '</td>' +
      '<td>' + esc(x.student_id || "—") + '</td>' +
      '<td>' + esc(x.school || "—") + '</td>' +
      '<td>' + fmt(x.created_at) + '</td>' +
      '<td><button class="ghost-btn" data-request-ticket="' + esc(x.ticket_id || x.id || "") + '">Review</button></td>' +
    '</tr>'
  ).join("") || '<tr><td colspan="5" class="empty">No day-loaner requests.</td></tr>';

  document.querySelectorAll("[data-request-ticket]").forEach(b => b.onclick = () =>
    toast("Day-loaner request is queued for TechTeam handling.")
  );
}

function renderMembers() {
  const rows = dashboardRows.filter(x => x.record_type === "techteam_member");
  $("#memberRows").innerHTML = rows.map(x =>
    '<tr>' +
      '<td>' + esc(x.member_name || "—") + '</td>' +
      '<td>' + esc(x.student_id || "—") + '</td>' +
      '<td>' + esc(x.member_role || "—") + '</td>' +
      '<td>' + (x.member_active ? badge("Active") : '<span class="badge">Inactive</span>') + '</td>' +
      '<td><button class="ghost-btn" data-member-id="' + esc(x.student_id || "") + '">Edit</button></td>' +
    '</tr>'
  ).join("") || '<tr><td colspan="5" class="empty">No TechTeam members recorded.</td></tr>';

  document.querySelectorAll("[data-member-id]").forEach(b => b.onclick = () =>
    openMemberModal(b.dataset.memberId)
  );
}

async function loadReport() {
  if (actualRole !== "admin") {
    $("#reportBody").innerHTML = '<div class="empty">Admin access required.</div>';
    return;
  }

  $("#reportBody").innerHTML = '<div class="empty">Loading report…</div>';
  const r = await supabase.rpc("get_vils_report");

  if (r.error) {
    $("#reportBody").innerHTML = '<div class="empty">' + esc(r.error.message) + '</div>';
    return;
  }

  const data = r.data || {};
  const labels = [
    ["students","Students"],
    ["tickets_total","Total tickets"],
    ["tickets_open","Open tickets"],
    ["tickets_completed","Completed tickets"],
    ["lost_devices","Lost devices"],
    ["day_loaner_requests","Day-loaner requests"],
    ["loaners_total","Loaners"],
    ["loaners_available","Available loaners"],
    ["loaners_in_use","Loaners in use"],
    ["techteam_active","Active TechTeam"]
  ];

  $("#reportBody").innerHTML = labels.map(([key,label]) =>
    '<div class="stat-card"><span>' + label + '</span><strong>' +
    esc(data[key] ?? 0) + '</strong></div>'
  ).join("");
}

function renderMaintenance() {
  const connected = !$("#connectionStatus").textContent.toLowerCase().includes("unavailable");
  const rows = [
    ["Backend connection", connected, connected ? "Supabase reachable from the app." : "Backend connection failed."],
    ["Student source", true, "Student ID lookup is centralized through lookup_student."],
    ["Direct roster writes", true, "Application records use workflow RPCs rather than open client inserts."],
    ["Dashboard refresh", !!dashboardLoadedAt, dashboardLoadedAt ? "Last loaded " + fmt(dashboardLoadedAt) : "Dashboard has not loaded yet."]
  ];

  $("#maintenanceBody").innerHTML = rows.map(([label,ok,detail]) =>
    '<div class="maintenance-row"><span class="maintenance-icon ' + (ok ? "ok" : "bad") + '">' +
      (ok ? "✓" : "!") + '</span><div><strong>' + esc(label) + '</strong><p>' +
      esc(detail) + '</p></div></div>'
  ).join("");
}

function openModal(html) {
  const modal = $("#recordModal");
  modal.innerHTML = '<div class="modal-backdrop" data-close-modal></div><div class="modal-card">' + html + '</div>';
  modal.classList.remove("hidden");
  modal.querySelector("[data-close-modal]").onclick = closeModal;
  const close = modal.querySelector("#closeModal");
  if (close) close.onclick = closeModal;
}

function closeModal() {
  $("#recordModal").classList.add("hidden");
  activeTicket = null;
}

async function openTicketModal(ticketId) {
  const ticket = dashboardRows.find(x => x.record_type === "ticket" && x.ticket_id === ticketId);
  if (!ticket) return;
  activeTicket = ticket;

  openModal(
    '<div class="modal-head"><div><div class="eyebrow">TICKET ' + esc(ticket.ticket_id) + '</div>' +
    '<h2>Ticket details</h2></div><button class="ghost-btn" id="closeModal">Close</button></div>' +
    '<div class="detail-grid">' +
      '<div><span>Student / teacher</span><strong>' + esc(ticket.student_name || ticket.teacher_name || "—") + '</strong></div>' +
      '<div><span>Student ID</span><strong>' + esc(ticket.student_id || "—") + '</strong></div>' +
      '<div><span>Device</span><strong>' + esc(ticket.device_type || "Not available") + '</strong></div>' +
      '<div><span>Serial</span><strong>' + esc(ticket.device_serial || "Not available") + '</strong></div>' +
    '</div>' +
    '<form id="ticketEditForm" class="modal-form">' +
      '<label>Status<select name="status">' +
        ["Pending","Sent to Outsource Repair","In House Repair","Device Ready","Completed"].map(s =>
          '<option ' + (ticket.status === s ? "selected" : "") + '>' + s + '</option>'
        ).join("") +
      '</select></label>' +
      '<label>Assigned technician<input name="assigned_technician" value="' + esc(ticket.assigned_technician || "") + '" placeholder="TechTeam member"></label>' +
      '<label>Diagnosis notes<textarea name="diagnosis_notes" rows="4">' + esc(ticket.diagnosis_notes || "") + '</textarea></label>' +
      '<label>Additional needs<textarea name="additional_needs" rows="3">' + esc(ticket.additional_needs || "") + '</textarea></label>' +
      '<div id="shippingFields" class="' + (ticket.status === "Sent to Outsource Repair" ? "" : "hidden") + '">' +
        '<h3>Outsource shipping</h3>' +
        '<div class="two-col">' +
          '<label>Vendor<input name="shipping_vendor" value="' + esc(ticket.shipping_vendor || "") + '"></label>' +
          '<label>Tracking number<input name="tracking_number" value="' + esc(ticket.tracking_number || "") + '"></label>' +
          '<label>Ship date<input name="shipping_date" type="date" value="' + esc(ticket.shipping_date || "") + '"></label>' +
          '<label>Expected return<input name="expected_return_date" type="date" value="' + esc(ticket.expected_return_date || "") + '"></label>' +
          '<label>Shipping status<input name="shipping_status" value="' + esc(ticket.shipping_status || "") + '"></label>' +
          '<label>Return date<input name="return_date" type="date" value="' + esc(ticket.return_date || "") + '"></label>' +
        '</div>' +
        '<label>Shipping notes<textarea name="shipping_notes" rows="3">' + esc(ticket.shipping_notes || "") + '</textarea></label>' +
      '</div>' +
      '<button class="primary-btn" type="submit">Save changes <span>→</span></button>' +
      '<p id="modalMsg" class="form-msg"></p>' +
    '</form>'
  );

  const form = $("#ticketEditForm");
  const status = $('select[name="status"]', form);
  status.onchange = () => $("#shippingFields").classList.toggle("hidden", status.value !== "Sent to Outsource Repair");

  form.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    $("#modalMsg").textContent = "Saving…";

    const r = await supabase.rpc("update_ticket_workflow", {
      p_ticket_id: ticket.ticket_id,
      p_status: fd.get("status"),
      p_assigned_technician: fd.get("assigned_technician"),
      p_diagnosis_notes: fd.get("diagnosis_notes"),
      p_additional_needs: fd.get("additional_needs"),
      p_shipping_vendor: fd.get("shipping_vendor"),
      p_tracking_number: fd.get("tracking_number"),
      p_shipping_date: fd.get("shipping_date") || null,
      p_expected_return_date: fd.get("expected_return_date") || null,
      p_shipping_status: fd.get("shipping_status"),
      p_shipping_notes: fd.get("shipping_notes"),
      p_return_date: fd.get("return_date") || null
    });

    if (r.error) {
      btn.disabled = false;
      $("#modalMsg").textContent = r.error.message;
      return;
    }

    toast("Ticket " + ticket.ticket_id + " updated");
    closeModal();
    await loadDashboard();
  };
}

function openLoanerModal(serial = "") {
  const loaner = dashboardRows.find(x => x.record_type === "loaner" && x.loaner_serial === serial);
  const creating = !loaner;

  openModal(
    '<div class="modal-head"><div><div class="eyebrow">' + (creating ? "LOANER INVENTORY" : "LOANER " + esc(serial)) +
    '</div><h2>' + (creating ? "Add loaner" : "Manage loaner") + '</h2></div>' +
    '<button class="ghost-btn" id="closeModal">Close</button></div>' +
    '<form id="loanerForm" class="modal-form">' +
      '<label>Serial<input name="serial" required value="' + esc(loaner?.loaner_serial || "") + '" ' + (creating ? "" : "readonly") + '></label>' +
      '<label>Device type<input name="type" required value="' + esc(loaner?.loaner_type || "") + '" placeholder="Chromebook"></label>' +
      '<label>Status<select name="status">' +
        ["Available","In Use","Maintenance","Retired"].map(s =>
          '<option ' + (loaner?.loaner_status === s ? "selected" : "") + '>' + s + '</option>'
        ).join("") +
      '</select></label>' +
      '<label>Notes<textarea name="notes" rows="3">' + esc(loaner?.metadata?.notes || "") + '</textarea></label>' +
      '<div class="modal-actions">' +
        (creating ? '<button class="primary-btn" type="submit">Create loaner <span>+</span></button>' :
          '<button class="primary-btn" type="submit">Save loaner <span>→</span></button>') +
        (!creating && loaner?.loaner_status === "In Use"
          ? '<button type="button" class="ghost-btn" id="releaseLoaner">Release loaner</button>' : '') +
      '</div><p id="modalMsg" class="form-msg"></p>' +
    '</form>'
  );

  const form = $("#loanerForm");
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    $("#modalMsg").textContent = "Saving…";

    const r = creating
      ? await supabase.rpc("create_loaner", {
          p_loaner_serial: fd.get("serial"),
          p_loaner_type: fd.get("type"),
          p_notes: fd.get("notes")
        })
      : await supabase.rpc("update_loaner", {
          p_loaner_serial: fd.get("serial"),
          p_loaner_type: fd.get("type"),
          p_loaner_status: fd.get("status"),
          p_notes: fd.get("notes")
        });

    if (r.error) {
      btn.disabled = false;
      $("#modalMsg").textContent = r.error.message;
      return;
    }

    toast(creating ? "Loaner added" : "Loaner updated");
    closeModal();
    await loadDashboard();
  };

  const release = $("#releaseLoaner");
  if (release) release.onclick = async () => {
    release.disabled = true;
    const r = await supabase.rpc("release_loaner", { p_loaner_serial: serial });
    if (r.error) {
      $("#modalMsg").textContent = r.error.message;
      release.disabled = false;
      return;
    }
    toast("Loaner released");
    closeModal();
    await loadDashboard();
  };
}

function openMemberModal(studentId = "") {
  const member = dashboardRows.find(x =>
    x.record_type === "techteam_member" && x.student_id === studentId
  );
  const editing = !!member;

  openModal(
    '<div class="modal-head"><div><div class="eyebrow">TECHTEAM ACCESS</div><h2>' +
    (editing ? "Edit member" : "Add member") + '</h2></div><button class="ghost-btn" id="closeModal">Close</button></div>' +
    '<form id="memberForm" class="modal-form">' +
      '<label>Student ID<input name="student_id" inputmode="numeric" required value="' + esc(studentId) + '" ' + (editing ? "readonly" : "") + '></label>' +
      '<label>Member role<input name="member_role" required value="' + esc(member?.member_role || "TechTeam") + '"></label>' +
      '<label class="check-row"><input name="active" type="checkbox" ' + (member?.member_active !== false ? "checked" : "") + '> Active member</label>' +
      '<button class="primary-btn" type="submit">Save member <span>→</span></button>' +
      '<p id="modalMsg" class="form-msg"></p>' +
    '</form>'
  );

  $("#memberForm").onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const btn = e.currentTarget.querySelector('button[type="submit"]');
    btn.disabled = true;
    $("#modalMsg").textContent = "Saving…";

    const r = await supabase.rpc("upsert_techteam_member", {
      p_student_id: fd.get("student_id"),
      p_member_role: fd.get("member_role"),
      p_active: fd.get("active") === "on"
    });

    if (r.error) {
      btn.disabled = false;
      $("#modalMsg").textContent = r.error.message;
      return;
    }

    toast("TechTeam member saved");
    closeModal();
    await loadDashboard();
  };
}

$("#ticketStatusFilter").onchange = renderTickets;
$("#ticketSort").onchange = renderTickets;
$("#refreshDash").onclick = loadDashboard;

supabase.auth.getSession().then(r => {
  session = r.data.session;
  actualRole = roleFromSession(session);
  if (session) {
    $("#signOutBtn").classList.remove("hidden");
    if (["admin","techteam"].includes(actualRole)) loadDashboard();
  }
});

supabase.auth.onAuthStateChange((_event, s) => {
  session = s;
  actualRole = roleFromSession(s);

  if (!s) {
    $("#signOutBtn").classList.add("hidden");
    if (!views.landing.classList.contains("hidden")) return;
    show("landing");
  }
});

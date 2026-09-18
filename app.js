import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase=createClient("https://zazqpuanjoxpnglqwuoc.supabase.co","sb_publishable_FTgIJ4cbLk6we0_ZaCyMig_lJxNe9Cd");
const $=s=>document.querySelector(s);
const views={landing:$("#landingView"),auth:$("#authView"),student:$("#studentView"),teacher:$("#teacherView"),dashboard:$("#dashboardView"),guide:$("#guideView")};
let selectedRole="", session=null, dashboardRows=[];

const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const show=n=>{Object.values(views).forEach(v=>v.classList.add("hidden"));views[n].classList.remove("hidden");scrollTo(0,0)};
const toast=m=>{const t=$("#toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600)};
const fmt=d=>d?new Date(d).toLocaleString([], {dateStyle:"medium",timeStyle:"short"}):"—";
const statusClass=s=>({Pending:"pending","Sent to Outsource Repair":"outsource","In House Repair":"repair","Device Ready":"ready",Completed:"complete"}[s]||"pending");
const badge=s=>'<span class="badge '+statusClass(s)+'">'+esc(s||"Pending")+"</span>";

async function checkBackend(){
 const r=await supabase.from("app_records").select("id",{count:"exact",head:true});
 $("#connectionStatus").innerHTML=r.error?'<i class="bad"></i> Backend unavailable':'<i></i> Backend connected';
}
checkBackend();

function auth(role){
 selectedRole=role;
 $("#authTitle").textContent=role==="techteam"?"TechTeam sign in":role==="admin"?"Admin sign in":role==="teacher"?"Teacher / Staff sign in":"Student sign in";
 $("#authCopy").textContent=role==="student"?"Sign in with your authorized student account.":role==="teacher"?"Use your authorized staff account.":"Use your authorized operations account to continue.";
 $("#authError").textContent="";show("auth");
}
document.querySelectorAll("[data-role]").forEach(b=>b.onclick=()=>auth(b.dataset.role));
document.querySelectorAll("[data-back]").forEach(b=>b.onclick=()=>show("landing"));
$("#backHome").onclick=()=>show("landing");
$("#openGuide").onclick=()=>show("guide");
$("#signOutBtn").onclick=async()=>{await supabase.auth.signOut();session=null;$("#signOutBtn").classList.add("hidden");show("landing")};

$("#authForm").onsubmit=async e=>{
 e.preventDefault();$("#authError").textContent="Signing in…";
 const r=await supabase.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#password").value});
 if(r.error){$("#authError").textContent=r.error.message;return}
 session=r.data.session;$("#signOutBtn").classList.remove("hidden");
 if(selectedRole==="student")show("student");else if(selectedRole==="teacher")show("teacher");else await loadDashboard();
};

async function lookupStudent(id){
 const r=await supabase.rpc("lookup_student",{p_student_id:String(id).trim()});
 if(r.error||!r.data?.length)throw new Error(r.error?.message||"No matching student found.");
 return r.data[0];
}
function studentCard(s){return '<strong>'+esc(s.student_name||"Student")+'</strong><div class="student-meta"><span>'+esc(s.school||"School unavailable")+'</span><span>ID: '+esc(s.student_id)+'</span><span>Asset: '+esc(s.asset_tag||"Not available")+'</span><span>Serial: '+esc(s.device_serial||"Not available")+'</span><span>Type: '+esc(s.device_type||"Not available")+'</span></div>'}

document.querySelectorAll("[data-service]").forEach(b=>b.onclick=()=>studentForm(b.dataset.service));
function studentForm(type){
 const wrap=$("#studentFormWrap");
 wrap.innerHTML='<form id="studentForm" class="form-card service-form"><div class="student-result" id="studentResult"><strong>Student lookup</strong><div class="student-meta"><span>Enter your Student ID to load your roster/device information.</span></div></div><label>Student ID<input id="studentId" required inputmode="numeric" placeholder="Enter Student ID"></label><button type="button" class="ghost-btn" id="lookupBtn">Lookup student</button><div id="dynamicFields"></div><button class="primary-btn" id="submitStudentBtn" type="submit" disabled>Submit request <span>→</span></button><p id="studentMsg" class="form-msg"></p></form>';
 let loaded=null;
 $("#lookupBtn").onclick=async()=>{
  const id=$("#studentId").value.trim();if(!id)return;
  $("#studentMsg").textContent="Looking up…";
  try{
   loaded=await lookupStudent(id);$("#studentForm").dataset.studentId=loaded.student_id;$("#studentResult").innerHTML=studentCard(loaded);
   let f="";
   if(type==="ticket")f='<label>Reason<select name="repair_reason" required><option value="">Select one</option><option>Cracked Screen</option><option>Keyboard Issue</option><option>Trackpad Repair</option><option>Won\'t Power On</option><option>Battery Issue</option><option>Charging Port</option><option>Software Issue</option><option>Other</option></select></label><label>Describe the issue<textarea name="issue_description" rows="4" required placeholder="Include useful details."></textarea></label>';
   if(type==="lost")f='<label>Last known room<input name="last_known_room" required></label><label>Last known class / period<input name="last_known_class_period" required></label><label>Describe your case<textarea name="case_description" rows="4" required placeholder="Tell us what happened."></textarea></label><label>Device identifying features<textarea name="device_identifying_features" rows="3" required placeholder="Case, stickers, scratches, labels, or other identifying details."></textarea></label>';
   if(type==="loaner")f='<div class="student-result"><strong>Day loaner request</strong><div class="student-meta"><span>Your request will be linked to this student record. A TechTeam member will handle assignment.</span></div></div>';
   $("#dynamicFields").innerHTML=f;$("#submitStudentBtn").disabled=false;$("#studentMsg").textContent="";
  }catch(err){loaded=null;$("#studentMsg").textContent=err.message;$("#submitStudentBtn").disabled=true}
 };
 $("#studentForm").onsubmit=async e=>{
  e.preventDefault();const id=e.currentTarget.dataset.studentId;if(!id)return;const fd=new FormData(e.currentTarget);let fn,args;
  if(type==="ticket"){fn="create_student_ticket";args={p_student_id:id,p_repair_reason:fd.get("repair_reason"),p_issue_description:fd.get("issue_description"),p_submitted_by_role:"student",p_teacher_name:null,p_teacher_room_or_period:null}}
  else if(type==="lost"){fn="create_lost_device_report";args={p_student_id:id,p_last_known_room:fd.get("last_known_room"),p_last_known_class_period:fd.get("last_known_class_period"),p_case_description:fd.get("case_description"),p_device_identifying_features:fd.get("device_identifying_features")}}
  else {fn="create_day_loaner_request";args={p_student_id:id}}
  $("#studentMsg").textContent="Submitting…";const r=await supabase.rpc(fn,args);
  if(r.error){$("#studentMsg").textContent=r.error.message;return}
  toast((r.data?.ticket_id||"Request")+" submitted");$("#studentMsg").textContent="Submitted successfully.";$("#submitStudentBtn").disabled=true;
 };
}

document.querySelectorAll('input[name="ticket_type"]').forEach(r=>r.onchange=()=>{
 const student=r.value==="student";$("#teacherStudentFields").classList.toggle("hidden",!student);$("#teacherDeviceFields").classList.toggle("hidden",student);
 $("#teacherStudentId").required=student;
});
let teacherStudent=null;
$("#teacherLookup").onclick=async()=>{
 const id=$("#teacherStudentId").value.trim();if(!id)return;$("#teacherStudentResult").textContent="Looking up…";
 try{teacherStudent=await lookupStudent(id);$("#teacherStudentResult").innerHTML=studentCard(teacherStudent)}catch(e){teacherStudent=null;$("#teacherStudentResult").textContent=e.message}
};
$("#teacherForm").onsubmit=async e=>{
 e.preventDefault();const f=new FormData(e.currentTarget), type=f.get("ticket_type");$("#teacherMsg").textContent="Submitting…";
 if(type==="student"&&!teacherStudent){$("#teacherMsg").textContent="Look up a student before submitting.";return}
 const r=type==="student"
  ?await supabase.rpc("create_student_ticket",{p_student_id:teacherStudent.student_id,p_repair_reason:f.get("repair_reason"),p_issue_description:f.get("issue_description"),p_submitted_by_role:"teacher",p_teacher_name:f.get("teacher_name"),p_teacher_room_or_period:f.get("room_or_period")})
  :await supabase.rpc("create_teacher_device_ticket",{p_teacher_name:f.get("teacher_name"),p_school:f.get("school"),p_device_serial:f.get("device_serial"),p_asset_tag:f.get("asset_tag"),p_room_or_period:f.get("room_or_period"),p_repair_reason:f.get("repair_reason"),p_issue_description:f.get("issue_description")});
 if(r.error){$("#teacherMsg").textContent=r.error.message;return}
 toast((r.data?.ticket_id||"Request")+" submitted");$("#teacherMsg").textContent="Request submitted successfully.";e.currentTarget.reset();teacherStudent=null;$("#teacherStudentResult").textContent="No student loaded.";document.querySelector('input[value="student"]').dispatchEvent(new Event("change"));
};

function activatePanel(name){
 document.querySelectorAll(".dash-panel").forEach(x=>x.classList.add("hidden"));$("#dash"+name[0].toUpperCase()+name.slice(1)).classList.remove("hidden");
 document.querySelectorAll(".nav-card").forEach(x=>x.classList.toggle("active",x.dataset.panel===name));
}
document.querySelectorAll(".nav-card").forEach(b=>b.onclick=()=>activatePanel(b.dataset.panel));
$("#jumpTickets").onclick=()=>activatePanel("tickets");

async function loadDashboard(){
 show("dashboard");$("#dashRole").textContent=selectedRole.toUpperCase();
 const r=await supabase.from("app_records").select("*").in("record_type",["ticket","lost_device_report","loaner","activity"]).order("created_at",{ascending:false});
 if(r.error){$("#ticketRows").innerHTML='<tr><td colspan="5" class="empty">'+esc(r.error.message)+"</td></tr>";return}
 dashboardRows=r.data||[];
 const tickets=dashboardRows.filter(x=>x.record_type==="ticket"), loaners=dashboardRows.filter(x=>x.record_type==="loaner"), lost=dashboardRows.filter(x=>x.record_type==="lost_device_report"), activity=dashboardRows.filter(x=>x.record_type==="activity");
 $("#openCount").textContent=tickets.filter(x=>x.status!=="Completed").length;$("#loanerCount").textContent=loaners.filter(x=>x.loaner_status==="In Use").length;$("#lostCount").textContent=lost.length;$("#activityCount").textContent=activity.length;
 $("#reminderText").textContent=tickets.filter(x=>x.status!=="Completed").length+" ticket(s) still need attention.";
 renderTickets();renderLoaners(loaners);renderShipping(tickets);renderLost(lost);renderActivity(activity);
}
function renderTickets(){
 const filter=$("#ticketStatusFilter").value, sort=$("#ticketSort").value;
 let rows=dashboardRows.filter(x=>x.record_type==="ticket"&&(filter==="all"||x.status===filter));
 rows.sort((a,b)=>sort==="asc"?new Date(a.created_at)-new Date(b.created_at):new Date(b.created_at)-new Date(a.created_at));
 $("#ticketRows").innerHTML=rows.slice(0,50).map(x=>'<tr><td><strong>'+esc(x.ticket_id||"—")+'</strong></td><td>'+esc(x.student_name||x.teacher_name||"—")+'<small>'+esc(x.student_id||x.teacher_room_or_period||"")+'</small></td><td>'+esc(x.repair_reason||"—")+'</td><td>'+badge(x.status)+'</td><td>'+fmt(x.created_at)+'</td></tr>').join("")||'<tr><td colspan="5" class="empty">No tickets match this filter.</td></tr>';
}
function renderLoaners(rows){$("#loanerRows").innerHTML=rows.map(x=>'<tr><td>'+esc(x.device_serial||x.loaner_serial||"—")+'</td><td>'+esc(x.loaner_type||"—")+'</td><td>'+esc(x.loaner_status||"—")+'</td><td>'+esc(x.assigned_student_name||"—")+'</td><td>'+esc(x.assigned_to_ticket||"—")+'</td></tr>').join("")||'<tr><td colspan="5" class="empty">No loaners recorded.</td></tr>'}
function renderShipping(rows){const x=rows.filter(r=>r.shipping_vendor||r.tracking_number||r.shipping_date);$("#shippingRows").innerHTML=x.map(r=>'<tr><td>'+esc(r.ticket_id||"—")+'</td><td>'+esc(r.shipping_vendor||"—")+'</td><td>'+esc(r.tracking_number||"—")+'</td><td>'+esc(r.shipping_date||"—")+'</td><td>'+esc(r.expected_return_date||"—")+'</td></tr>').join("")||'<tr><td colspan="5" class="empty">No outsourced shipping records.</td></tr>'}
function renderLost(rows){$("#lostRows").innerHTML=rows.map(x=>'<tr><td>'+esc(x.student_name||"—")+'</td><td>'+esc(x.student_id||"—")+'</td><td>'+esc(x.last_known_room||"—")+'</td><td>'+esc(x.last_known_class_period||"—")+'</td><td>'+esc(x.status||"Reported")+'</td></tr>').join("")||'<tr><td colspan="5" class="empty">No lost-device reports.</td></tr>'}
function renderActivity(rows){$("#activityRows").innerHTML=rows.slice(0,50).map(x=>'<tr><td>'+esc(x.action_type||"—")+'</td><td>'+esc(x.action_description||"—")+'</td><td>'+esc(x.performed_by_name||x.performed_by||"—")+'</td><td>'+fmt(x.action_time||x.created_at)+'</td></tr>').join("")||'<tr><td colspan="4" class="empty">No activity recorded.</td></tr>'}
$("#ticketStatusFilter").onchange=renderTickets;$("#ticketSort").onchange=renderTickets;$("#refreshDash").onclick=loadDashboard;

supabase.auth.getSession().then(r=>{session=r.data.session;if(session)$("#signOutBtn").classList.remove("hidden")});
supabase.auth.onAuthStateChange((_event,s)=>{session=s;if(!s){$("#signOutBtn").classList.add("hidden");if(!views.landing.classList.contains("hidden"))return;show("landing")}});

// Plain JS app using Firebase via CDN modules
// Make sure window.firebaseConfig is filled in index.html

// Import Firebase (CDN ESM)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"

// ---- Setup ----
const app = initializeApp(window.firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)

// UI elements
const loginSection = document.getElementById('loginSection')
const dashboardSection = document.getElementById('dashboardSection')
const logoutBtn = document.getElementById('logoutBtn')
const loginForm = document.getElementById('loginForm')
const loginMsg = document.getElementById('loginMsg')
const emailEl = document.getElementById('email')
const passwordEl = document.getElementById('password')

const founders = ['Founder A','Founder B','Founder C']

// Populate founders select
const paidBySelect = document.getElementById('paidBy')
founders.forEach(f=>{
  const opt = document.createElement('option')
  opt.value = f; opt.textContent = f
  paidBySelect.appendChild(opt)
})

// Default date
document.getElementById('date').value = new Date().toISOString().slice(0,10)

// Auth state
onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user
  loginSection.classList.toggle('hidden', loggedIn)
  dashboardSection.classList.toggle('hidden', !loggedIn)
  logoutBtn.classList.toggle('hidden', !loggedIn)
  if(loggedIn){ attachTxnStream() }
})

logoutBtn.addEventListener('click', ()=>signOut(auth))

loginForm.addEventListener('submit', async (e)=>{
  e.preventDefault()
  loginMsg.textContent = ''
  try{
    await signInWithEmailAndPassword(auth, emailEl.value, passwordEl.value)
  }catch(err){
    loginMsg.textContent = err.message || 'Login failed'
  }
})

// ---- Add Transaction ----
const txnForm = document.getElementById('txnForm')
const amountEl = document.getElementById('amount')
const descEl = document.getElementById('desc')
const dateEl = document.getElementById('date')
const txnMsg = document.getElementById('txnMsg')

txnForm.addEventListener('submit', async (e)=>{
  e.preventDefault()
  txnMsg.textContent = ''
  const amt = parseFloat(amountEl.value)
  if(isNaN(amt) || amt <= 0){ txnMsg.textContent = 'Enter a valid amount'; return }
  try{
    await addDoc(collection(db, 'transactions'), {
      amount: amt,
      paidBy: paidBySelect.value,
      description: descEl.value || '',
      date: dateEl.value,
      createdAt: serverTimestamp()
    })
    amountEl.value=''; descEl.value=''
    paidBySelect.value = founders[0]
    dateEl.value = new Date().toISOString().slice(0,10)
    txnMsg.textContent = 'Added ✅'
  }catch(err){
    txnMsg.textContent = err.message || 'Failed to add'
  }
})

// ---- Live list + summary ----
let unsub = null
function attachTxnStream(){
  if(unsub) unsub()
  const q = query(collection(db,'transactions'), orderBy('createdAt','desc'))
  unsub = onSnapshot(q, (snap)=>{
    const txns = snap.docs.map(d=>({ id:d.id, ...d.data() }))
    renderTxns(txns)
    renderSummary(txns)
    renderTransfers(txns)
  })
}

function renderTxns(txns){
  const body = document.getElementById('txnsBody')
  body.innerHTML = ''
  txns.forEach(t=>{
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${t.date||''}</td><td>${escapeHtml(t.description||'')}</td><td>${t.paidBy||''}</td><td>₹ ${(Number(t.amount||0)).toFixed(2)}</td>`
    body.appendChild(tr)
  })
}

function renderSummary(txns){
  const total = txns.reduce((s,t)=>s+Number(t.amount||0),0)
  const perHead = founders.length ? total / founders.length : 0
  document.getElementById('total').textContent = `₹ ${total.toFixed(2)}`
  document.getElementById('perHead').textContent = `₹ ${perHead.toFixed(2)}`

  const paidTotals = Object.fromEntries(founders.map(f=>[f,0]))
  txns.forEach(t=>{ if(paidTotals[t.paidBy]!==undefined){ paidTotals[t.paidBy]+=Number(t.amount||0) } })

  const tbody = document.getElementById('summaryBody')
  tbody.innerHTML = ''
  founders.forEach(name=>{
    const net = (paidTotals[name]||0) - perHead
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${name}</td>
      <td>₹ ${(paidTotals[name]||0).toFixed(2)}</td>
      <td style="color:${net>=0?'#86efac':'#fca5a5'}">${net>=0?'+':''}${net.toFixed(2)}</td>`
    tbody.appendChild(tr)
  })
}

function renderTransfers(txns){
  const { transfers } = computeSettlement(txns, founders)
  const ul = document.getElementById('transfersList')
  ul.innerHTML = ''
  if(!transfers.length){
    const li = document.createElement('li'); li.textContent = 'All settled 🎉'
    ul.appendChild(li); return
  }
  transfers.forEach(t=>{
    const li = document.createElement('li')
    li.innerHTML = `<span class="badge">${t.from}</span> pays <strong>₹ ${t.amount.toFixed(2)}</strong> to <span class="badge">${t.to}</span>`
    ul.appendChild(li)
  })
}

// ---- Settlement logic ----
function computeSettlement(txns, founders){
  const total = txns.reduce((s,t)=>s+Number(t.amount||0),0)
  const perHead = founders.length ? total/founders.length : 0
  const balances = Object.fromEntries(founders.map(f=>[f,0]))
  txns.forEach(t=>{
    const amt = Number(t.amount||0)
    if(!isNaN(amt) && balances[t.paidBy]!==undefined){ balances[t.paidBy]+=amt }
  })
  founders.forEach(f=> balances[f] = (balances[f]||0) - perHead )

  const debtors = [], creditors = []
  Object.entries(balances).forEach(([name,bal])=>{
    if(bal < -0.005) debtors.push({name, amt:-bal})
    else if(bal > 0.005) creditors.push({name, amt:bal})
  })
  debtors.sort((a,b)=>b.amt-a.amt); creditors.sort((a,b)=>b.amt-a.amt)

  const transfers = []
  let i=0,j=0
  while(i<debtors.length && j<creditors.length){
    const pay = Math.min(debtors[i].amt, creditors[j].amt)
    transfers.push({from: debtors[i].name, to: creditors[j].name, amount: pay})
    debtors[i].amt -= pay; creditors[j].amt -= pay
    if(debtors[i].amt <= 0.005) i++
    if(creditors[j].amt <= 0.005) j++
  }
  return { total, perHead, balances, transfers }
}

function escapeHtml(str){
  return str.replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]))
}

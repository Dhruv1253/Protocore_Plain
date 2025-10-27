// Plain JS app using Firebase via CDN modules

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"

// ---- Setup ----
const app = initializeApp(window.firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)

// Founder list (sorted) and colors
const founders = ['Dhruv','Shubham','Vishal'] // consistent order
const founderKey = name => name.toLowerCase()
const colorClass = name => ({
  dhruv: 'tag-dhruv',
  vishal: 'tag-vishal',
  shubham: 'tag-shubham'
})[founderKey(name)] || ''

// UI elements
const loginSection = document.getElementById('loginSection')
const dashboardSection = document.getElementById('dashboardSection')
const whoami = document.getElementById('whoami')
const logoutBtn = document.getElementById('logoutBtn')
const loginForm = document.getElementById('loginForm')
const loginMsg = document.getElementById('loginMsg')
const emailEl = document.getElementById('email')
const passwordEl = document.getElementById('password')

const paidBySelect = document.getElementById('paidBy')
founders.forEach(f=>{
  const opt = document.createElement('option')
  opt.value = f; opt.textContent = f
  paidBySelect.appendChild(opt)
})

document.getElementById('date').value = new Date().toISOString().slice(0,10)

let currentUser = null
let unsub = null
let editState = { id: null } // if not null -> editing

onAuthStateChanged(auth, (user)=>{
  currentUser = user
  const loggedIn = !!user
  loginSection.classList.toggle('hidden', loggedIn)
  dashboardSection.classList.toggle('hidden', !loggedIn)
  logoutBtn.classList.toggle('hidden', !loggedIn)
  whoami.textContent = loggedIn ? (user.email || 'Logged in') : ''
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

// ---- Add / Edit Transaction ----
const txnForm = document.getElementById('txnForm')
const amountEl = document.getElementById('amount')
const descEl = document.getElementById('desc')
const dateEl = document.getElementById('date')
const txnMsg = document.getElementById('txnMsg')
const saveBtn = document.getElementById('saveBtn')
const cancelEditBtn = document.getElementById('cancelEditBtn')

txnForm.addEventListener('submit', async (e)=>{
  e.preventDefault()
  txnMsg.textContent = ''
  const amt = parseFloat(amountEl.value)
  if(isNaN(amt) || amt <= 0){ txnMsg.textContent = 'Enter a valid amount'; return }
  try{
    if(editState.id){
      // Only Dhruv can edit (client-side check)
      if(!currentUser || currentUser.email !== window.editorEmail){
        txnMsg.textContent = 'Only Dhruv can edit.'; return
      }
      const ref = doc(db, 'transactions', editState.id)
      await updateDoc(ref, {
        amount: amt,
        paidBy: paidBySelect.value,
        description: descEl.value || '',
        date: dateEl.value,
        editedAt: serverTimestamp(),
        editedBy: currentUser.email
      })
      txnMsg.textContent = 'Updated ✅'
    }else{
      await addDoc(collection(db, 'transactions'), {
        amount: amt,
        paidBy: paidBySelect.value,
        description: descEl.value || '',
        date: dateEl.value,
        createdAt: serverTimestamp()
      })
      txnMsg.textContent = 'Added ✅'
    }
    resetForm()
  }catch(err){
    txnMsg.textContent = err.message || 'Failed to save'
  }
})

cancelEditBtn.addEventListener('click', ()=> resetForm())

function startEdit(txn){
  if(!currentUser || currentUser.email !== window.editorEmail){
    alert('Only Dhruv can edit.'); return
  }
  editState.id = txn.id
  amountEl.value = Number(txn.amount||0)
  descEl.value = txn.description || ''
  dateEl.value = txn.date || new Date().toISOString().slice(0,10)
  paidBySelect.value = txn.paidBy || founders[0]
  saveBtn.textContent = 'Update Transaction'
  cancelEditBtn.classList.remove('hidden')
  txnMsg.textContent = 'Editing…'
}

function resetForm(){
  editState.id = null
  amountEl.value = ''
  descEl.value = ''
  paidBySelect.value = founders[0]
  dateEl.value = new Date().toISOString().slice(0,10)
  saveBtn.textContent = 'Add Transaction'
  cancelEditBtn.classList.add('hidden')
}

// ---- Live list + summary ----
function attachTxnStream(){
  if(unsub) unsub()
  const q = query(collection(db,'transactions'), orderBy('createdAt','desc'))
  unsub = onSnapshot(q, (snap)=>{
    const txns = snap.docs.map(d=>({ id:d.id, ...d.data() }))
    renderTxns(txns)
    renderSummary(txns)
    renderTransfers(txns)
    cacheTxns = txns
  })
}

function renderTxns(txns){
  const body = document.getElementById('txnsBody')
  body.innerHTML = ''
  txns.forEach(t=>{
    const tr = document.createElement('tr')
    const editedInfo = t.editedBy ? `by ${t.editedBy}` : ''
    tr.innerHTML = `
      <td>${t.date||''}</td>
      <td>${escapeHtml(t.description||'')}</td>
      <td>
        <span class="tag ${colorClass(t.paidBy)}"><span class="tag-dot"></span>${t.paidBy||''}</span>
      </td>
      <td>₹ ${(Number(t.amount||0)).toFixed(2)}</td>
      <td>${t.editedAt ? new Date(t.editedAt.seconds*1000).toLocaleString()+' '+editedInfo : ''}</td>
      <td>
        <button class="action-btn" ${(!currentUser || currentUser.email!==window.editorEmail) ? 'disabled' : ''} data-edit="${t.id}">✏️ Edit</button>
      </td>`
    body.appendChild(tr)
  })
  // Wire edit buttons
  body.querySelectorAll('button[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-edit')
      const txn = txns.find(x=>x.id===id)
      if(txn) startEdit(txn)
    })
  })
}

function renderSummary(txns){
  // Order founders fixed
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
    tr.innerHTML = `<td><span class="tag ${colorClass(name)}"><span class="tag-dot"></span>${name}</span></td>
      <td><span class="tag ${colorClass(name)}"><span class="tag-dot"></span>₹ ${(paidTotals[name]||0).toFixed(2)}</span></td>
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
    li.innerHTML = `<span class="tag ${colorClass(t.from)}"><span class="tag-dot"></span>${t.from}</span> pays <strong>₹ ${t.amount.toFixed(2)}</strong> to <span class="tag ${colorClass(t.to)}"><span class="tag-dot"></span>${t.to}</span>`
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

// ---- Reports: CSV + Chart ----
const exportCsvBtn = document.getElementById('exportCsvBtn')
const showChartBtn = document.getElementById('showChartBtn')
const fromDateEl = document.getElementById('fromDate')
const toDateEl = document.getElementById('toDate')
const reportMsg = document.getElementById('reportMsg')
const reportCanvas = document.getElementById('reportChart')
let reportChart = null
let cacheTxns = []

exportCsvBtn.addEventListener('click', ()=>{
  const { txns, rangeText } = filterByMonthRange(cacheTxns)
  const rows = [['Date','Description','Paid By','Amount']].concat(
    txns.map(t=>[t.date||'', (t.description||'').replace(/\n/g,' '), t.paidBy||'', String(Number(t.amount||0).toFixed(2))])
  )
  const csv = rows.map(r=>r.map(field=>`"${(field||'').replace(/"/g,'""')}"`).join(',')).join('\n')
  downloadBlob(csv, `transactions_${rangeText}.csv`, 'text/csv')
  reportMsg.textContent = `Exported ${txns.length} rows`
})

showChartBtn.addEventListener('click', ()=>{
  const { monthly, labels, rangeText } = monthlyAggregate(cacheTxns)
  if(reportChart){ reportChart.destroy(); }
  reportChart = new Chart(reportCanvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Monthly Total (₹)',
        data: labels.map(k=>monthly[k]||0)
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true }, title: { display: true, text: `Transactions: ${rangeText}` } },
      scales: { y: { beginAtZero: true } }
    }
  })
})

function filterByMonthRange(all){
  // Inputs are YYYY-MM; include months between inclusive
  const from = fromDateEl.value ? fromDateEl.value+'-01' : null
  const to = toDateEl.value ? toDateEl.value+'-31' : null
  const ok = (d)=>{
    if(!d) return false
    if(from && d < from) return false
    if(to && d > to) return false
    return true
  }
  const txns = all.filter(t=> ok(t.date||''))
  const rangeText = `${fromDateEl.value||'all'}_to_${toDateEl.value||'all'}`
  return { txns, rangeText }
}

function monthlyAggregate(all){
  const { txns, rangeText } = filterByMonthRange(all)
  const monthly = {}
  txns.forEach(t=>{
    const m = (t.date||'').slice(0,7) // YYYY-MM
    const amt = Number(t.amount||0) || 0
    monthly[m] = (monthly[m]||0) + amt
  })
  const labels = Object.keys(monthly).sort()
  return { monthly, labels, rangeText }
}

function downloadBlob(content, filename, type){
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ---- Utils ----
function escapeHtml(str){
  return str.replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]))
}

// Copie de maquette/src/matcher.js faite par scripts/sync-matcher.mjs : ne pas modifier ici.
/* Moteur de correction (sans IA) : normalisation, variantes, distance d'édition de Damerau-Levenshtein, garde-fous médicaux */
const STOP=new Set("a au aux avec ce ces d de des du en et l la le les ou par pour sans sur un une chez son sa ses sont tres plus ex chien chiens chat chats chienne animal animaux maladie maladies syndrome insuffisance cause causes signe signes type types atteinte forme formes trouble troubles notamment surtout etc cite citez".split(" "));
const norm=s=>String(s).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/œ/g,"oe").replace(/æ/g,"ae").replace(/[^a-z0-9]+/g," ").trim();
/* une lettre seule compte quand elle suit « vitamine », « alopécie »… (vitamine A ≠ vitamine D) */
const KP=new Set(["vitamine","vitamines","alopecie","type","facteur","groupe","hepatite"]);
/* « D-lactique » reste un seul mot ; « en H », « en U » aussi (lambeau en H) */
const words=s=>{const o=[];for(const w of norm(String(s).replace(/\b([A-Za-z])-(?=[A-Za-z])/g,"$10")).split(" ").filter(Boolean)){
    if(w.length===1&&o.length&&(KP.has(o[o.length-1])||o[o.length-1]==="en")){o[o.length-1]+="_"+w;continue;}o.push(w);}return o;};
/* racine grossière : pluriel et accord (rénal/rénale, aigu/aiguë, digestif/digestive, anaux/anal) */
const stem=w=>{if(w.length<=4)return w;w=w.replace(/eaux$/,"eau").replace(/aux$/,"al").replace(/[sx]$/,"").replace(/ive$/,"if").replace(/euse$/,"eu").replace(/ienne$/,"ien").replace(/elle$/,"el");return w.length>4?w.replace(/e+$/,""):w;};
/* mots de remplissage ignorés quand la réponse contient d'autres mots (« ingestion de chocolat », « choc sévère ») */
const FILLER=new Set("intoxication ingestion toxicite toxique toxiques empoisonnement consommation severe severes grave graves important importante marque marquee presence canin canine felin feline".split(" "));
/* mot de tête trop général pour valoir à lui seul une réponse précise (« carcinome » ≠ carcinome neuroendocrine cutané) */
const GENERIC=new Set("carcinome sarcome tumeur neoplasie cancer infection lesion deficit anomalie fracture rupture obstruction torsion greffe osteotomie suture".split(" ").map(w=>stem(w)));
const unfill=ws=>{const r=ws.filter(w=>!FILLER.has(w));return r.length?r:ws;};
function osa(a,b){const m=a.length,n=b.length;if(Math.abs(m-n)>2)return 9;const d=[];for(let i=0;i<=m;i++)d[i]=[i];for(let j=0;j<=n;j++)d[0][j]=j;
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++){const c=a[i-1]===b[j-1]?0:1;d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+c);
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);}return d[m][n];}
/* préfixes de sens opposé : une ou deux lettres changent le diagnostic (hypo/hyper…) */
const OPP=[["hypo","hyper"],["hyper","hypo"],["intra","extra"],["extra","intra"],["pre","post"],["post","pre"],["endo","exo"],["exo","endo"],["hemi","hemo"],["hemo","hemi"]];
const COMB=new Set(["hyper","hypo","intra","extra","cardio","gastro","neuro","hemat","hemo","poly","mega","micro","macro","endo","ecto","peri","para","osteo","derma","entero","myelo","lympho","hepato","nephro","pneumo"]);
const SUF=["ectomie","otomie","ostomie","rraphie","plastie","pexie","emie","urie","oide","ome","ite","ose"];
const suf=w=>{w=w.replace(/s$/,"");return SUF.find(x=>w.endsWith(x))||"";};
/* distance entre un mot de la réponse (a) et un mot tapé (b) ; -1 si différents */
function wdist(a,b){if(a===b)return 0;if(a.includes("_")||b.includes("_"))return -1;const sa=stem(a),sb=stem(b);if(sa===sb)return 0;
  if(a.length<5||b.length<5)return -1;
  for(const[p,q]of OPP)if(a.startsWith(p)&&b.startsWith(q))return -1;
  /* suffixes de sens différent : carcinome ≠ carcinoïde, arthrite ≠ arthrose, entérotomie ≠ entérectomie */
  const fa=suf(a),fb=suf(b);if(fa&&fb&&fa!==fb)return -1;
  if(b.length>=5&&!COMB.has(b)&&a.startsWith(b)&&a.length-b.length<=7)return 1;
  if(a[0]!==b[0])return -1;
  for(const p of COMB)if(a.startsWith(p)&&b.startsWith(p)&&a.slice(p.length,p.length+2)!==b.slice(p.length,p.length+2))return -1;
  const tol=Math.min(a.length,b.length)>=8?2:1,d=osa(sa,sb);return d<=tol?d:-1;}
const best=(x,Y)=>{let m=-1;for(const y of Y){const d=wdist(x,y);if(d>=0&&(m<0||d<m))m=d;}return m;};
/* variantes : texte entier, morceaux séparés par « / », contenu des parenthèses (synonyme ou liste d'exemples, pas les races) */
function variants(label){const out=new Set([label]);const base=label.replace(/\([^)]*\)/g," ").replace(/\s+/g," ").trim();out.add(base);
  base.split(/\s*\/\s*|\s+ou\s+/).forEach(p=>{if(p.trim())out.add(p.trim());});
  (label.match(/\(([^)]*)\)/g)||[]).map(x=>x.slice(1,-1).trim()).forEach(inner=>{
    if(/\b[A-Z][a-z]/.test(inner)&&!/^[A-Z]{2,}\b/.test(inner))return; if(/[<>≥≤°]|\d/.test(inner))return;
    inner.split(/\s*[,;/]\s*|\s+ou\s+/).forEach(p=>{if(p&&!/^(ex|notamment|surtout)\b/.test(p))out.add(p);});});
  return [...out];}
function prepare(q){const qw=new Set(words(q.q).map(stem));const keep=w=>!STOP.has(w)&&!qw.has(stem(w))&&w.length>1;const qa=[...qw];
  /* côté joueur, un mot de la question mal orthographié (« lameau ») est aussi ignoré */
  const ikeep=w=>keep(w)&&!qa.some(x=>{if(x.length<6)return false;const d=wdist(x,w);return d>=0&&d<=1;});
  const sig=ws=>{const r=ws.filter(keep);return r.length?r:ws.filter(w=>!STOP.has(w));};q.sig=sig;q.isig=ws=>ws.filter(ikeep);q.ans.forEach(a=>{const syn=a[3]||[];
    a.v=[...variants(a[0]),...syn].map(v=>({n:norm(v),w:unfill(sig(words(v)))})).filter(v=>v.n&&v.w.length);
    /* mots du libellé complet et des synonymes : tolérés en plus dans la réponse tapée (« surdité du dalmatien ») */
    a.ctx=[...new Set([a[0],...syn].flatMap(v=>sig(words(v))))];});return q;}
function judge(q,input){const n=norm(input||"");if(!n)return{kind:"empty"};const I=unfill(q.isig(words(input)));
  if(!I.length)return{kind:"vague",why:"question"};let gen=false;
  /* pour chaque réponse, la variante qui explique le plus de mots tapés, puis le meilleur score */
  const C=[];
  q.ans.forEach((a,idx)=>{let B={key:-1,used:[],cov:[]};const cx=I.map((y,j)=>a.ctx.some(x=>wdist(x,y)>=0)?j:-1).filter(j=>j>=0);
    for(const v of a.v){let k=-1,u;
      if(v.n===n){k=1000;u=I.map((_,j)=>j);}
      else{const dA=v.w.map(x=>best(x,I)),m=dA.filter(d=>d>=0).length,dist=dA.filter(d=>d>0).reduce((s,d)=>s+d,0);
        u=I.map((y,j)=>v.w.some(x=>wdist(x,y)>=0)?j:-1).filter(j=>j>=0);
        const un=I.filter((_,j)=>!u.includes(j)&&!cx.includes(j)).length,cov=m/v.w.length,head=dA[0]>=0,inAll=un===0||(un===1&&I.length>=3&&cov>=.6);
        if(m===v.w.length)k=600+Math.min(v.w.length,9)*20-dist*15;
        else if(inAll&&(cov>=.5||head)){if(v.w.length>1&&u.length===1&&GENERIC.has(stem(v.w[0]))&&GENERIC.has(stem(I[u[0]]))){gen=true;}else k=200+Math.round(cov*150)+(head?40:0)-dist*15;}}
      if(k<0)continue;if(u.length>B.used.length||(u.length===B.used.length&&k>B.key))B={key:k,used:u};}
    if(B.key>=0)C.push({idx,key:B.key,used:B.used,all:[...new Set([...B.used,...cx])]});});
  if(!C.length)return gen?{kind:"vague",why:"generic"}:{kind:"miss"};
  C.sort((x,y)=>y.used.length-x.used.length||y.key-x.key);const W=C[0];
  /* plusieurs réponses tapées d'un coup (« parvo giardiose ») : une seule réponse par question */
  const rest=I.filter((_,j)=>!W.all.includes(j));
  if(rest.length&&q.ans.some((a,idx)=>idx!==W.idx&&a.v.some(v=>rest.some(y=>wdist(v.w[0],y)>=0))))return{kind:"multi"};
  const c=C.filter(x=>x.used.length===W.used.length&&x.key===W.key).map(x=>q.ans[x.idx]).sort((x,y)=>x[1]-y[1]);
  return{kind:"ok",label:c[0][0],tier:c[0][1],alts:c.slice(1).filter(x=>x[1]>c[0][1]).map(x=>x[0])};}
export { norm, judge, prepare, variants };

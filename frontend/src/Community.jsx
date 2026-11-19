import React,{useCallback,useEffect,useState} from 'react';
import {Heart,MessageCircle,Send,UserRound,Wallet,RefreshCw,ExternalLink,LogOut,Image as ImageIcon} from 'lucide-react';
import {supabase} from './lib/supabase.js';

const shortAddress=value=>value?value.slice(0,6)+'…'+value.slice(-4):'Wallet member';
const ago=value=>{const seconds=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/1000));if(seconds<60)return 'Just now';if(seconds<3600)return Math.floor(seconds/60)+'m ago';if(seconds<86400)return Math.floor(seconds/3600)+'h ago';return Math.floor(seconds/86400)+'d ago'};
const avatar=(profile)=>profile?.avatar_url||'';

async function walletSignIn(account){
 if(!account)throw new Error('Connect your wallet first.');
 if(!window.ethereum)throw new Error('MetaMask was not detected.');
 const chainId=await window.ethereum.request({method:'eth_chainId'});
 if(chainId!=='0x1159')throw new Error('Switch MetaMask to LiteForge (Chain 4441) first.');
 const {data,error}=await supabase.auth.signInWithWeb3({chain:'ethereum',statement:'Sign in to LitBazaar Community with this wallet. This signature does not send a transaction or cost gas.'});
 if(error)throw error;
 if(!data.user?.id)throw new Error('Wallet authentication did not return a user account.');
 const uid=data.user.id;
 const {data:existing,error:readError}=await supabase.from('profiles').select('id,wallet_address').eq('id',uid).maybeSingle();
 if(readError)throw readError;
 if(existing&&existing.wallet_address?.toLowerCase()!==account.toLowerCase()){
  await supabase.auth.signOut();
  throw new Error('The signed-in wallet does not match the connected wallet. Please reconnect and sign in again.');
 }
 if(!existing){
  const {error:insertError}=await supabase.from('profiles').insert({id:uid,wallet_address:account,username:'Creator'});
  if(insertError)throw insertError;
 }
 return data.session;
}

export function Community({account,onConnect}){
 const [session,setSession]=useState(null),[authBusy,setAuthBusy]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [posts,setPosts]=useState([]),[draft,setDraft]=useState(''),[category,setCategory]=useState('General'),[expanded,setExpanded]=useState(''),[comments,setComments]=useState({}),[commentDraft,setCommentDraft]=useState({});
 const [filter,setFilter]=useState('All');
 useEffect(()=>{supabase.auth.getSession().then(({data})=>setSession(data.session));const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>setSession(next));return()=>subscription.unsubscribe()},[]);
 const loadPosts=useCallback(async()=>{
  setBusy(true);setError('');
  try{
   let request=supabase.from('posts').select('id,user_id,category,content,image_path,nft_name,nft_url,created_at,profiles!posts_user_id_fkey(username,wallet_address,avatar_url)').eq('is_hidden',false).order('created_at',{ascending:false}).limit(50);
   if(filter!=='All')request=request.eq('category',filter);
   const {data,error:postError}=await request;if(postError)throw postError;
   const ids=(data||[]).map(p=>p.id);
   let likes=[],commentRows=[];
   if(ids.length){
    const [l,c]=await Promise.all([
     supabase.from('post_likes').select('post_id,user_id').in('post_id',ids),
     supabase.from('comments').select('post_id').in('post_id',ids)
    ]);
    if(l.error)throw l.error;if(c.error)throw c.error;likes=l.data||[];commentRows=c.data||[];
   }
   const uid=session?.user?.id;
   setPosts((data||[]).map(p=>({...p,likeCount:likes.filter(x=>x.post_id===p.id).length,commentCount:commentRows.filter(x=>x.post_id===p.id).length,liked:!!uid&&likes.some(x=>x.post_id===p.id&&x.user_id===uid)})));
  }catch(e){setError(e.message||'Could not load community posts.')}
  finally{setBusy(false)}
 },[filter,session?.user?.id]);
 useEffect(()=>{loadPosts()},[loadPosts]);
 const signIn=async()=>{if(!account){onConnect?.();return}setAuthBusy(true);setError('');setNotice('Approve the wallet sign-in message. No gas fee is charged.');try{const next=await walletSignIn(account);setSession(next);setNotice('Wallet verified. You can now post and interact.')}catch(e){setError(e.message||'Wallet sign-in failed.')}finally{setAuthBusy(false)}};
 const createPost=async()=>{
  if(!session){setError('Sign in with your wallet before posting.');return}
  if(!draft.trim()){setError('Write something before publishing.');return}
  setBusy(true);setError('');
  try{const {error:e}=await supabase.from('posts').insert({user_id:session.user.id,category,content:draft.trim()});if(e)throw e;setDraft('');setNotice('Your post has been published.');await loadPosts()}
  catch(e){setError(e.message||'Post could not be published.')}finally{setBusy(false)}
 };
 const toggleLike=async post=>{
  if(!session){setError('Sign in with your wallet to like posts.');return}
  setError('');
  try{
   const result=post.liked
    ?await supabase.from('post_likes').delete().eq('post_id',post.id).eq('user_id',session.user.id)
    :await supabase.from('post_likes').insert({post_id:post.id,user_id:session.user.id});
   if(result.error)throw result.error;await loadPosts();
  }catch(e){setError(e.message||'Could not update like.')}
 };
 const loadComments=async postId=>{
  if(expanded===postId){setExpanded('');return}
  setExpanded(postId);setError('');
  const {data,error:e}=await supabase.from('comments').select('id,post_id,user_id,parent_id,content,created_at,profiles!comments_user_id_fkey(username,wallet_address,avatar_url)').eq('post_id',postId).order('created_at',{ascending:true}).limit(100);
  if(e)setError(e.message);else setComments(v=>({...v,[postId]:data||[]}));
 };
 const addComment=async post=>{
  if(!session){setError('Sign in with your wallet to comment.');return}
  const content=(commentDraft[post.id]||'').trim();if(!content)return;
  const {error:e}=await supabase.from('comments').insert({post_id:post.id,user_id:session.user.id,content});
  if(e){setError(e.message);return}
  setCommentDraft(v=>({...v,[post.id]:''}));await loadComments(post.id);setExpanded(post.id);await loadPosts();
 };
 const categories=['All','General','NFT Showcase','Creator Zone','Marketplace','LitVM Ecosystem','Help'];
 return <section className="community-page">
  <div className="community-heading"><div><small>LITBAZAAR SOCIAL</small><h1>Community</h1><p>Meet creators, share your NFTs and talk about the LitVM ecosystem.</p></div><button className="community-refresh" onClick={loadPosts} disabled={busy}><RefreshCw size={15}/> Refresh</button></div>
  {error&&<div className="community-alert error">{error}</div>}{notice&&<div className="community-alert">{notice}</div>}
  {!session?<div className="community-auth"><span><Wallet size={22}/></span><div><b>Connect with your wallet to join the conversation</b><p>Wallet signature only. No gas fee, no password and no email required.</p></div><button className="primary" onClick={signIn} disabled={authBusy}>{authBusy?'Waiting for signature':account?'Sign in with wallet':'Connect wallet'}</button></div>:<div className="community-composer"><div className="composer-avatar"><UserRound size={20}/></div><div className="composer-fields"><textarea value={draft} onChange={e=>setDraft(e.target.value.slice(0,3000))} placeholder="Share an update with the LitBazaar community…" rows="3"/><div className="composer-bottom"><select value={category} onChange={e=>setCategory(e.target.value)}>{categories.filter(x=>x!=='All').map(x=><option key={x}>{x}</option>)}</select><small>{draft.length}/3000</small><button className="primary" onClick={createPost} disabled={busy||!draft.trim()}><Send size={14}/> Publish post</button></div></div></div>}
  <div className="community-filters">{categories.map(x=><button key={x} className={filter===x?'active':''} onClick={()=>setFilter(x)}>{x}</button>)}</div>
  <div className="community-feed">{posts.map(post=><article className="community-post" key={post.id}>
   <div className="post-author"><div className="post-avatar">{avatar(post.profiles)?<img src={avatar(post.profiles)} alt=""/>:<UserRound size={19}/>}</div><div><b>{post.profiles?.username||shortAddress(post.profiles?.wallet_address)}</b><small>{shortAddress(post.profiles?.wallet_address)} · {ago(post.created_at)}</small></div><span className="post-category">{post.category}</span></div>
   <p className="post-content">{post.content}</p>
   {post.nft_url&&<a className="post-nft-link" href={post.nft_url} target="_blank" rel="noreferrer">{post.nft_name||'View NFT'} <ExternalLink size={13}/></a>}
   <div className="post-actions"><button className={post.liked?'liked':''} onClick={()=>toggleLike(post)}><Heart size={16} fill={post.liked?'currentColor':'none'}/> {post.likeCount} Likes</button><button onClick={()=>loadComments(post.id)}><MessageCircle size={16}/> {post.commentCount} Comments</button></div>
   {expanded===post.id&&<div className="post-comments">{(comments[post.id]||[]).map(c=><div className="post-comment" key={c.id}><b>{c.profiles?.username||shortAddress(c.profiles?.wallet_address)}</b><span>{c.content}</span><small>{ago(c.created_at)}</small></div>)}{session&&<div className="comment-compose"><input value={commentDraft[post.id]||''} onChange={e=>setCommentDraft(v=>({...v,[post.id]:e.target.value}))} placeholder="Write a comment…" maxLength={1200}/><button onClick={()=>addComment(post)} disabled={!(commentDraft[post.id]||'').trim()}><Send size={15}/></button></div>}{!session&&<button className="text-action" onClick={signIn}>Sign in with wallet to comment</button>}</div>}
  </article>)}{!busy&&!posts.length&&<div className="community-empty"><MessageCircle size={28}/><b>No posts in this category yet</b><span>Be the first to start a conversation.</span></div>}</div>
 </section>;
}

export function ProfilePage({account,nfts=[],collections=[],onConnect,onTab}){
 const [session,setSession]=useState(null),[profile,setProfile]=useState(null),[username,setUsername]=useState(''),[bio,setBio]=useState(''),[avatarUrl,setAvatarUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{supabase.auth.getSession().then(({data})=>setSession(data.session));const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>setSession(next));return()=>subscription.unsubscribe()},[]);
 useEffect(()=>{let live=true;(async()=>{if(!session?.user?.id)return;const {data,error:e}=await supabase.from('profiles').select('*').eq('id',session.user.id).maybeSingle();if(!live)return;if(e){setError(e.message);return}if(data){setProfile(data);setUsername(data.username||'Creator');setBio(data.bio||'');setAvatarUrl(data.avatar_url||'')}})();return()=>{live=false}},[session?.user?.id]);
 const signIn=async()=>{if(!account){onConnect?.();return}setBusy(true);setError('');try{const next=await walletSignIn(account);setSession(next)}catch(e){setError(e.message||'Wallet sign-in failed.')}finally{setBusy(false)}};
 const save=async()=>{if(!session||!profile)return;setBusy(true);setError('');setNotice('');const {data,error:e}=await supabase.from('profiles').update({username:username.trim(),bio:bio.trim(),avatar_url:avatarUrl.trim()||null,updated_at:new Date().toISOString()}).eq('id',session.user.id).select().single();if(e)setError(e.message);else{setProfile(data);setNotice('Profile saved.')}setBusy(false)};
 const signOut=async()=>{await supabase.auth.signOut();setSession(null);setProfile(null);setNotice('Wallet community session signed out.')};
 const owned=nfts.filter(n=>account&&n.owner.toLowerCase()===account.toLowerCase());
 return <section className="profile-page">
  <div className="community-heading"><div><small>YOUR LITBAZAAR ACCOUNT</small><h1>Profile</h1><p>Your creator identity and on-chain collection activity.</p></div></div>
  {error&&<div className="community-alert error">{error}</div>}{notice&&<div className="community-alert">{notice}</div>}
  {!session?<div className="community-auth"><span><Wallet size={22}/></span><div><b>Sign in to manage your creator profile</b><p>Verify your wallet with a free signature.</p></div><button className="primary" onClick={signIn} disabled={busy}>{account?'Sign in with wallet':'Connect wallet'}</button></div>:<div className="profile-layout">
   <div className="profile-editor"><div className="profile-big-avatar">{avatarUrl?<img src={avatarUrl} alt="Profile avatar"/>:<UserRound size={38}/>}</div><small>CONNECTED WALLET</small><b className="profile-wallet">{account||profile?.wallet_address}</b><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} minLength={2} maxLength={32}/></label><label>Avatar image URL<input value={avatarUrl} onChange={e=>setAvatarUrl(e.target.value)} placeholder="https://…"/></label><label>Bio<textarea value={bio} onChange={e=>setBio(e.target.value)} rows="4" maxLength={240} placeholder="Tell the community about yourself…"/></label><small>{bio.length}/240 characters</small><button className="primary" onClick={save} disabled={busy||username.trim().length<2}>{busy?'Saving…':'Save profile'}</button><button className="profile-signout" onClick={signOut}><LogOut size={15}/> Sign out of community</button></div>
   <div className="profile-overview"><div className="profile-stat-grid"><div><b>{owned.length}</b><small>Owned NFTs</small></div><div><b>{collections.length}</b><small>Collections indexed</small></div><div><b>{nfts.filter(n=>account&&n.owner.toLowerCase()===account.toLowerCase()).length}</b><small>Verified on-chain</small></div></div><div className="profile-owned-head"><h2>My collectibles</h2><button className="text-action" onClick={()=>onTab?.('My NFTs')}>Open My NFTs →</button></div><div className="profile-owned-grid">{owned.slice(0,8).map(n=><button key={n.collection+n.id} onClick={()=>onTab?.('My NFTs')}><div>{n.image?<img src={n.image} alt={n.name}/>:<ImageIcon size={24}/>}</div><b>{n.name}</b><small>#{n.id}</small></button>)}</div>{!owned.length&&<div className="community-empty"><ImageIcon size={26}/><b>No NFTs in this wallet yet</b><span>Mint or collect an NFT to see it here.</span><button className="secondary" onClick={()=>onTab?.('Create')}>Create NFT</button></div>}</div>
  </div>}
 </section>;
}

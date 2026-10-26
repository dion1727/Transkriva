"""Transkriva: web lokal untuk mesin Whisper proyek asli.
Jalankan: python server.py. Akses: http://127.0.0.1:5000
"""
import json, os, sys, subprocess, threading, time, uuid, mimetypes, re
from pathlib import Path
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote
from email.parser import BytesParser
from email.policy import default

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / 'static'
UPLOADS = ROOT / 'uploads'; UPLOADS.mkdir(exist_ok=True)
OUTPUTS = ROOT / 'outputs'; OUTPUTS.mkdir(exist_ok=True)
JOBS = {}; LOCK = threading.RLock(); MAX_UPLOAD = 300 * 1024 * 1024
ALLOWED = {'.mp3','.wav','.m4a','.flac','.mp4','.mov','.aac','.ogg','.webm','.mkv','.wma','.opus'}


def sanitize_log(line):
    """Keep debugging useful while hiding absolute local paths from the web UI."""
    line = str(line)
    line = re.sub(r'(?i)[a-z]:[\\/](?:[^\s\"\']+[\\/])*[^\s\"\']+', '[local path]', line)
    line = re.sub(r'(?<![\w:])(?:/home/|/Users/|/mnt/)[^\s\"\']+', '[local path]', line)
    return line[:1500]


def safe_job(job_id):
    with LOCK: return JOBS.get(job_id)


def read_outputs(job):
    output=Path(job['output'])
    text_file=output/'transkrip.txt'; json_file=output/'hasil.json'
    if not text_file.is_file(): return
    job['text']=text_file.read_text('utf-8')
    if json_file.is_file():
        try:
            data=json.loads(json_file.read_text('utf-8'))
            job['segments']=[{'start':float(s.get('start',0)),'end':float(s.get('end',0)),'text':s.get('text','')} for s in data.get('segments',[])]
            job['detected_language']=data.get('language','')
        except Exception:pass


def run_job(job):
    command=[sys.executable,'-u',str(ROOT/'worker.py'),job['input'],'--output',job['output'],'--model',job['model'],'--language',job['language'],'--device',job['device']]
    creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0
    try:
        env=os.environ.copy();env['PYTHONIOENCODING']='utf-8'
        proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,encoding='utf-8',errors='replace',text=True,bufsize=1,creationflags=creationflags,env=env)
        with LOCK: job['process']=proc;job['status']='running';job['message']='Memuat Whisper dan memproses audio…'
        for line in proc.stdout:
            line=line.strip()
            if not line:continue
            with LOCK:
                job['logs'].append(line);job['logs']=job['logs'][-160:]
                if 'Mengonversi' in line: job['message']='Mengonversi audio…'
                elif 'Memuat model' in line:job['message']='Memuat model AI (pertama kali dapat mengunduh model)…'
                elif 'Transkripsi dimulai' in line:job['message']='Transkripsi sedang berlangsung…'
                elif 'SELESAI:' in line:job['message']='Menyimpan hasil…'
        code=proc.wait()
        with LOCK:
            if job['status']=='cancelled':job['message']='Proses dibatalkan.'
            elif code==0:
                read_outputs(job);job['status']='done';job['message']='Transkripsi selesai. Hasil siap diunduh.'
            else:job['status']='error';job['message']='Proses gagal. Periksa log dan instalasi Whisper/CUDA.'
            job['finished_at']=datetime.now().isoformat(timespec='seconds')
    except Exception as exc:
        with LOCK:job['status']='error';job['message']=str(exc);job['logs'].append(str(exc))


def gpu_info():
    result={'gpu_available':False,'gpu_name':'Tidak terdeteksi','cuda_version':None}
    try:
        import torch
        result['gpu_available']=bool(torch.cuda.is_available())
        if result['gpu_available']:
            result['gpu_name']=torch.cuda.get_device_name(0)
            result['cuda_version']=torch.version.cuda
    except ImportError:result['gpu_name']='PyTorch belum terinstal'
    return result


class Handler(BaseHTTPRequestHandler):
    server_version='Transkriva/1.0'
    def respond(self,code=200,payload=None,content_type='application/json; charset=utf-8',data=None):
        raw=data if data is not None else json.dumps(payload or {},ensure_ascii=False).encode('utf-8')
        self.send_response(code);self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(raw)))
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.send_header('Cache-Control','no-store')
        self.end_headers();self.wfile.write(raw)
    def json(self,payload,code=200):self.respond(code,payload)
    def do_GET(self):
        route=urlparse(self.path).path
        if route=='/api/system':return self.json({'device':gpu_info(),'models':['tiny','base','small','medium','turbo'],'host':'local','max_upload_mb':300})
        if route=='/api/jobs':
            with LOCK:items=[self.public(j) for j in reversed(list(JOBS.values()))]
            return self.json({'jobs':items})
        if route.startswith('/api/jobs/'):
            parts=route.strip('/').split('/')
            if len(parts)<3:return self.json({'error':'Tidak ditemukan'},404)
            job=safe_job(parts[2]);
            if not job:return self.json({'error':'Job tidak ditemukan'},404)
            if len(parts)==3:return self.json(self.public(job))
            if len(parts)==5 and parts[3]=='download':
                files={'txt':'transkrip.txt','timestamp':'transkrip_waktu.txt','srt':'subtitle.srt','json':'hasil.json','vtt':'subtitle.vtt'}
                name=files.get(parts[4]);
                if not name:return self.json({'error':'Format tidak dikenal'},404)
                target=Path(job['output'])/name
                if name=='subtitle.vtt' and not target.exists():
                    source=Path(job['output'])/'subtitle.srt'
                    if source.exists():
                        s=source.read_text('utf-8');lines=s.splitlines();filtered=[line.replace(',','.') for line in lines if not line.strip().isdigit()]
                        target.write_text('WEBVTT\n\n'+'\n'.join(filtered)+'\n','utf-8')
                if not target.is_file():return self.json({'error':'Belum ada hasil'},404)
                return self.respond(200,content_type='application/octet-stream',data=target.read_bytes())
        if route=='/':route='/index.html'
        relative=unquote(route).lstrip('/');file=(STATIC/relative).resolve()
        if not file.is_relative_to(STATIC.resolve()) or not file.is_file():return self.json({'error':'Tidak ditemukan'},404)
        mime=mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
        return self.respond(200,content_type=mime,data=file.read_bytes())
    def public(self,job):
        public_fields=('id','filename','model','language','device','status','message','created_at','finished_at','text','segments','detected_language','size')
        result={k:v for k,v in job.items() if k in public_fields}
        result['logs']=[sanitize_log(line) for line in job.get('logs',[])][-160:]
        result['message']=sanitize_log(result.get('message',''))
        return result
    def do_POST(self):
        # This server is local-only; reject attempts from an unrelated webpage.
        origin=self.headers.get('Origin','')
        if origin and origin not in ('http://127.0.0.1:5000','http://localhost:5000'):
            return self.json({'error':'Asal permintaan tidak diizinkan'},403)
        route=urlparse(self.path).path
        if route.startswith('/api/jobs/') and route.endswith('/cancel'):
            jid=route.split('/')[3];job=safe_job(jid)
            if not job:return self.json({'error':'Job tidak ditemukan'},404)
            with LOCK:
                proc=job.get('process')
                if job['status']=='running' and proc and proc.poll() is None:
                    job['status']='cancelled';job['message']='Menghentikan proses…'
                    if os.name=='nt':subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
                    else:proc.terminate()
            return self.json(self.public(job))
        if route!='/api/transcribe':return self.json({'error':'Tidak ditemukan'},404)
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<1 or size>MAX_UPLOAD:return self.json({'error':'Ukuran unggahan harus 1–300 MB'},413)
            content_type=self.headers.get('Content-Type','')
            if not content_type.startswith('multipart/form-data'):return self.json({'error':'Upload harus multipart/form-data'},400)
            raw=self.rfile.read(size)
            msg=BytesParser(policy=default).parsebytes(b'Content-Type: '+content_type.encode()+b'\r\nMIME-Version: 1.0\r\n\r\n'+raw)
            fields={};audio=None
            for part in msg.iter_parts():
                label=part.get_param('name',header='content-disposition')
                if label=='file':audio=part
                elif label:fields[label]=part.get_content().strip()
            if audio is None:return self.json({'error':'Pilih file audio/video'},400)
            filename=Path(audio.get_filename() or 'audio').name
            ext=Path(filename).suffix.lower()
            if ext not in ALLOWED:return self.json({'error':'Format file tidak didukung'},400)
            model=fields.get('model','small');language=fields.get('language','auto');device=fields.get('device','auto')
            if model not in ('tiny','base','small','medium','turbo') or language not in ('id','en','auto') or device not in ('auto','cpu','cuda'):
                return self.json({'error':'Pengaturan tidak valid'},400)
            if device=='cuda' and not gpu_info()['gpu_available']:return self.json({'error':'CUDA tidak tersedia. Pilih Auto atau CPU.'},400)
            with LOCK:
                if sum(j['status'] in ('queued','running') for j in JOBS.values())>=2:return self.json({'error':'Maksimal dua pekerjaan aktif/menunggu'},409)
            jid=uuid.uuid4().hex[:12];path=UPLOADS/(jid+ext);data=audio.get_payload(decode=True)
            if not data:return self.json({'error':'File kosong'},400)
            path.write_bytes(data)
            out=OUTPUTS/jid;out.mkdir()
            job={'id':jid,'filename':filename,'size':len(data),'input':str(path),'output':str(out),'model':model,'language':language,'device':device,'status':'queued','message':'Menunggu proses…','logs':[],'text':'','segments':[],'created_at':datetime.now().isoformat(timespec='seconds')}
            with LOCK:JOBS[jid]=job
            threading.Thread(target=run_job,args=(job,),daemon=True).start()
            return self.json(self.public(job),201)
        except Exception:return self.json({'error':'Kesalahan internal. Periksa terminal lokal.'},500)

if __name__=='__main__':
    print('Transkriva aktif: http://127.0.0.1:5000',flush=True)
    print('Tekan Ctrl+C untuk keluar.',flush=True)
    ThreadingHTTPServer(('127.0.0.1',5000),Handler).serve_forever()

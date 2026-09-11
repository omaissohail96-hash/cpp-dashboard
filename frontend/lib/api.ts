import type { DashboardResponse } from "./types";
const API=process.env.NEXT_PUBLIC_API_URL||"http://127.0.0.1:8000";
export async function uploadDashboardFiles(cpp1:File,cpp2:File,targetDate?:string):Promise<DashboardResponse>{const form=new FormData();form.append("cpp1_file",cpp1);form.append("cpp2_file",cpp2);if(targetDate)form.append("target_date",targetDate);const res=await fetch(`${API}/api/dashboard/upload`,{method:"POST",body:form});const body=await res.json().catch(()=>({}));if(!res.ok)throw new Error(body.detail||res.statusText);return body;}

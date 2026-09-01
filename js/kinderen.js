// kinderen.js — CRUD voor kinderen (verzamelaars) van de ingelogde ouder
import { supabase } from "./supabase.js";

const TABLE = "kinderen";

export async function loadKinderen(userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getKind(id) {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function addKind(userId, payload) {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...payload, user_id: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateKind(id, userId, payload) {
  const { error } = await supabase.from(TABLE).update(payload).eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

export async function deleteKind(id, userId) {
  const { error } = await supabase.from(TABLE).delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

export function isValidGeboortejaar(jaar) {
  const n = Number(jaar);
  const huidigJaar = new Date().getFullYear();
  return Number.isInteger(n) && n >= 1900 && n <= huidigJaar;
}

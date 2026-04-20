import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.DELIVERIES_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.DELIVERIES_SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

type Body = {
  codigo: string;
  nombre: string;
  isActive?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;

    const codigo = String(body.codigo ?? '').trim().toUpperCase();
    const nombre = String(body.nombre ?? '').trim();
    const isActive = body.isActive !== false;

    if (!codigo) {
      return NextResponse.json({ ok: false, error: 'Código requerido' }, { status: 400 });
    }

    if (!nombre) {
      return NextResponse.json({ ok: false, error: 'Nombre requerido' }, { status: 400 });
    }

    const { data: existingMap, error: existingMapError } = await supabase
      .from('driver_inventory_mapping')
      .select('driver_id, firebase_employee_code')
      .eq('firebase_employee_code', codigo)
      .maybeSingle();

    if (existingMapError) throw existingMapError;

    if (existingMap?.driver_id) {
      const { error: driverUpdateError } = await supabase
        .from('drivers')
        .update({
          nombre,
          activo: isActive,
        })
        .eq('id', existingMap.driver_id);

      if (driverUpdateError) throw driverUpdateError;

      const { error: mapUpdateError } = await supabase
        .from('driver_inventory_mapping')
        .update({
          firebase_employee_name: nombre,
          is_active: isActive,
        })
        .eq('firebase_employee_code', codigo);

      if (mapUpdateError) throw mapUpdateError;

      return NextResponse.json({
        ok: true,
        mode: 'updated',
        driver_id: existingMap.driver_id,
      });
    }

    const { data: driver, error: driverError } = await supabase
      .from('drivers')
      .insert({
        nombre,
        telefono: null,
        activo: isActive,
      })
      .select('id')
      .single();

    if (driverError) throw driverError;

    const { error: mappingError } = await supabase
      .from('driver_inventory_mapping')
      .insert({
        driver_id: driver.id,
        firebase_employee_code: codigo,
        firebase_employee_name: nombre,
        is_active: isActive,
      });

    if (mappingError) throw mappingError;

    return NextResponse.json({
      ok: true,
      mode: 'created',
      driver_id: driver.id,
    });
  } catch (error: any) {
    console.error('sync transport-to-deliveries error:', error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || 'Error sincronizando transporte con entregas',
      },
      { status: 500 }
    );
  }
}
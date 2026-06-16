import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import Sede  from './models/Sede.js'
import User  from './models/User.js'
import Order from './models/Order.js'

export async function connectDB() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('  MongoDB conectado:', process.env.MONGO_URI)
  await seed()
}

async function seed() {
  const shouldSeedBaseSedes    = process.env.SEED_BASE_SEDES === 'true'
  const shouldSeedBaseUsers    = process.env.SEED_BASE_USERS === 'true'
  const shouldSeedSampleOrders = process.env.SEED_SAMPLE_ORDERS === 'true'

  // ── Sedes ──────────────────────────────────────────────────────
  if (shouldSeedBaseSedes && (await Sede.countDocuments()) === 0) {
    await Sede.insertMany([
      { code: 'BOG', name: 'Bogota Norte',        city: 'Bogota',       manager: 'Laura Cardenas',  activeLines: 4 },
      { code: 'MED', name: 'Medellin Centro',     city: 'Medellin',     manager: 'Sergio Marin',    activeLines: 3 },
      { code: 'CAL', name: 'Cali Industrial',     city: 'Cali',         manager: 'Paula Jaramillo', activeLines: 5 },
      { code: 'BAR', name: 'Barranquilla Puerto', city: 'Barranquilla', manager: 'Diana De La Hoz', activeLines: 2 },
      { code: 'BUC', name: 'Bucaramanga Sur',     city: 'Bucaramanga',  manager: 'Juan Forero',     activeLines: 3 },
    ])
    console.log('  Sedes insertadas.')
  }

  // ── Usuarios base (solo si se habilita explícitamente)
  const hash = (p) => bcrypt.hashSync(p, 10)
  const defaultUsers = [
    { username: 'admin',  passwordHash: hash('admin123'), name: 'Administrador',     role: 'admin',    sede: null  },
    { username: 'bog_op', passwordHash: hash('op2024'),   name: 'Operario Bogotá',   role: 'operario', sede: 'BOG' },
    { username: 'med_op', passwordHash: hash('op2024'),   name: 'Operario Medellín', role: 'operario', sede: 'MED' },
    { username: 'cal_op', passwordHash: hash('op2024'),   name: 'Operario Cali',     role: 'operario', sede: 'CAL' },
    { username: 'bar_op', passwordHash: hash('op2024'),   name: 'Operario B/quilla', role: 'operario', sede: 'BAR' },
    { username: 'buc_op', passwordHash: hash('op2024'),   name: 'Operario B/manga',  role: 'operario', sede: 'BUC' },
  ]
  if (shouldSeedBaseUsers) {
    for (const u of defaultUsers) {
      await User.findOneAndUpdate(
        { username: u.username },
        { $set: u },
        { upsert: true }
      )
    }
    console.log('  Usuarios base sincronizados.')
  }

  // Mantiene al menos un admin para poder ingresar y crear todo desde cero.
  const adminExists = await User.exists({ role: 'admin' })
  if (!adminExists) {
    await User.create({
      username: 'admin',
      passwordHash: hash('admin123'),
      name: 'Administrador',
      role: 'admin',
      sede: null,
    })
    console.log('  Admin base creado (admin/admin123).')
  }

  // ── Órdenes de ejemplo (solo si se habilita explícitamente) ───
  if (shouldSeedSampleOrders && (await Order.countDocuments()) === 0) {
    const hoy  = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d }
    const ayer = (h, m = 0) => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(h, m, 0, 0); return d }

    await Order.insertMany([
      { code:'OP-240501', product:'Envase 500ml PET',         line:'L-01', batch:'BT-8801', status:'En proceso', priority:'Alta',  sede:'BOG', quantity:24000, completed:15800, operator:'Martha Ruiz',    scheduledAt:hoy(6),     updatedAt:hoy(9,12)  },
      { code:'OP-240502', product:'Tapa rosca 28mm',           line:'L-03', batch:'BT-8802', status:'Pendiente',  priority:'Media', sede:'MED', quantity:60000, completed:0,     operator:'Felipe Muñoz',   scheduledAt:hoy(10),    updatedAt:hoy(8)     },
      { code:'OP-240503', product:'Etiqueta lote exportacion', line:'L-05', batch:'BT-8803', status:'En proceso', priority:'Alta',  sede:'CAL', quantity:18000, completed:9700,  operator:'Daniela Torres', scheduledAt:hoy(7,30),  updatedAt:hoy(9,5)   },
      { code:'OP-240504', product:'Caja corrugada x24',        line:'L-02', batch:'BT-8804', status:'Completada', priority:'Baja',  sede:'BAR', quantity:5200,  completed:5200,  operator:'Adriana Perez',  scheduledAt:hoy(4),     updatedAt:hoy(7,45)  },
      { code:'OP-240505', product:'Bandeja termoformada',      line:'L-04', batch:'BT-8805', status:'En proceso', priority:'Alta',  sede:'BUC', quantity:12800, completed:12400, operator:'Jorge Vera',     scheduledAt:hoy(5,40),  updatedAt:hoy(9,20)  },
      { code:'OP-240506', product:'Estuche promocional',       line:'L-02', batch:'BT-8806', status:'Pendiente',  priority:'Media', sede:'BOG', quantity:7600,  completed:0,     operator:'Camilo Vega',    scheduledAt:hoy(13),    updatedAt:hoy(8,10)  },
      { code:'OP-240507', product:'Funda termosellada',        line:'L-01', batch:'BT-8807', status:'Completada', priority:'Media', sede:'MED', quantity:15000, completed:15000, operator:'Natalia Mesa',   scheduledAt:ayer(8,15), updatedAt:ayer(17,30)},
      { code:'OP-240508', product:'Sleeve termoencogible',     line:'L-06', batch:'BT-8808', status:'Completada', priority:'Alta',  sede:'CAL', quantity:22000, completed:22000, operator:'Jhon Ayala',     scheduledAt:ayer(6,45), updatedAt:ayer(16,55)},
      { code:'OP-240509', product:'Bolsa doypack',             line:'L-03', batch:'BT-8809', status:'Completada', priority:'Media', sede:'BAR', quantity:19800, completed:19800, operator:'Yina Ospino',    scheduledAt:ayer(1),    updatedAt:ayer(14,40)},
      { code:'OP-240510', product:'Tubo laminado 50g',         line:'L-07', batch:'BT-8810', status:'En proceso', priority:'Baja',  sede:'BUC', quantity:9800,  completed:2800,  operator:'Claudia Rangel', scheduledAt:ayer(9),    updatedAt:ayer(15,18)},
    ])
    console.log('  Órdenes insertadas.')
  }
}

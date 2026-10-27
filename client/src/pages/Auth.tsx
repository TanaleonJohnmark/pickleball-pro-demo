import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Field, Input, Select, ErrorBox } from '../components/ui';
import { Logo, PoweredBy } from '../components/Logo';
import brand from '../lib/brand';
import { DemoButtons, DemoBanner, useDemo } from '../components/Demo';

function Shell({ title, children, foot }: { title: string; children: React.ReactNode; foot: React.ReactNode }) {
  return (
    <div className="min-h-screen"><DemoBanner />
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col items-center justify-center gap-6 bg-navy-900 lg:flex">
        <img src={(brand as any).logoFull ?? brand.logo} alt={brand.clubName} className="h-[46vh] max-h-[460px] w-auto rounded-3xl" />
        <PoweredBy light />
      </div>
      <div className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <Link to="/" className="mb-10"><Logo /></Link>
        <h1 className="text-4xl font-bold">{title}</h1>
        <div className="mt-6 max-w-md">{children}</div>
        <p className="mt-6 text-navy-700">{foot}</p>
      </div>
    </div></div>
  );
}

const loginSchema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') });
export function Login() {
  const nav = useNavigate(); const [sp] = useSearchParams(); const { refresh } = useAuth();
  const [err, setErr] = useState<unknown>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const demo = useDemo().data?.demo;
  return (
    <Shell title="Sign in" foot={<>New here? <Link className="font-semibold text-court-600 underline" to="/register">Create an account</Link></>}>
      {demo && <div className="mb-6 rounded-lg border border-gold-400 bg-gold-100 p-4"><p className="mb-3 font-semibold text-navy-900">Just looking? Skip sign-in:</p><DemoButtons /></div>}
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => { setErr(null); try { await api.post('/auth/login', v); await refresh(); nav(sp.get('next') || '/app'); } catch (e) { setErr(e); } })}>
        {err ? <ErrorBox error={err} /> : null}
        <Field label="Email" error={errors.email?.message}><Input type="email" autoComplete="email" {...register('email')} /></Field>
        <Field label="Password" error={errors.password?.message}><Input type="password" autoComplete="current-password" {...register('password')} /></Field>
        <Button type="submit" loading={isSubmitting} className="w-full">Sign in</Button>
      </form>
    </Shell>
  );
}

const regSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name'), email: z.string().email('Enter a valid email'), phone: z.string().max(30).optional(),
  password: z.string().min(8, 'Use at least 8 characters').regex(/[A-Za-z]/, 'Include a letter').regex(/[0-9]/, 'Include a number'),
  confirm: z.string(), skillLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE']), preferredFormat: z.enum(['SINGLES', 'DOUBLES']),
}).refine((v) => v.password === v.confirm, { message: 'Passwords don’t match', path: ['confirm'] });
export function Register() {
  const nav = useNavigate(); const { refresh } = useAuth(); const [err, setErr] = useState<unknown>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof regSchema>>({ resolver: zodResolver(regSchema), defaultValues: { skillLevel: 'BEGINNER', preferredFormat: 'DOUBLES' } });
  return (
    <Shell title="Create your account" foot={<>Already a member? <Link className="font-semibold text-court-600 underline" to="/login">Sign in</Link></>}>
      <form className="space-y-4" onSubmit={handleSubmit(async ({ confirm, ...v }) => { setErr(null); try { await api.post('/auth/register', v); await refresh(); nav('/app'); } catch (e) { setErr(e); } })}>
        {err ? <ErrorBox error={err} /> : null}
        <Field label="Full name" error={errors.fullName?.message}><Input autoComplete="name" {...register('fullName')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" error={errors.email?.message}><Input type="email" autoComplete="email" {...register('email')} /></Field>
          <Field label="Mobile (optional)"><Input autoComplete="tel" {...register('phone')} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Skill level"><Select {...register('skillLevel')}><option value="BEGINNER">Beginner</option><option value="INTERMEDIATE">Intermediate</option><option value="ADVANCED">Advanced</option><option value="COMPETITIVE">Competitive</option></Select></Field>
          <Field label="Usually play"><Select {...register('preferredFormat')}><option value="DOUBLES">Doubles</option><option value="SINGLES">Singles</option></Select></Field>
        </div>
        <Field label="Password" error={errors.password?.message} hint="8+ characters with a letter and a number"><Input type="password" autoComplete="new-password" {...register('password')} /></Field>
        <Field label="Confirm password" error={errors.confirm?.message}><Input type="password" autoComplete="new-password" {...register('confirm')} /></Field>
        <Button type="submit" loading={isSubmitting} className="w-full">Create account</Button>
      </form>
    </Shell>
  );
}

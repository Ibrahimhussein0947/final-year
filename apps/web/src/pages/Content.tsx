import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { Alert, Card, TextAreaField, TextField } from '@/components/ui/primitives';
import { Accordion } from '@/components/ui/Accordion';
import { Button, LinkButton } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { useI18n } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { detectPlatform, INSTALL_STEPS, PLATFORM_LABEL, usePwa, type Platform } from '@/app/pwa';

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 leading-relaxed text-muted [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-text [&_li]:ml-5 [&_li]:list-disc">{children}</div>;
}

export function AboutPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('about.title')} subtitle={t('about.subtitle')} />
      <PageBody narrow>
        <Prose>
          <p>EthioTalent AI is a final-year academic project that explores how intelligent matching can make finding work and finding workers easier across Ethiopia, in both the formal and informal sectors.</p>
          <h2>The problems we target</h2>
          <ul>
            <li>Job seekers cannot easily find suitable or nearby opportunities.</li>
            <li>Employers struggle to find qualified workers.</li>
            <li>People without formal certificates are overlooked even when their practical skills are strong.</li>
            <li>Language barriers and fraudulent job adverts reduce trust.</li>
          </ul>
          <h2>Our approach</h2>
          <p>A hybrid matching engine scores skills (including related skills and semantic similarity), experience, location, qualifications, availability and pay expectations. Each recommendation shows its score breakdown. The system assists people and never makes final hiring decisions.</p>
          <h2>Honesty about status</h2>
          <p>The platform is under active development. Features that are not built yet are labeled as such rather than simulated.</p>
        </Prose>
      </PageBody>
    </>
  );
}

export function HowItWorksPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('how.title')} subtitle={t('section.how.subtitle')} />
      <PageBody narrow>
        <div className="grid gap-5">
          {[1, 2, 3].map((n) => (
            <Card key={n} className="p-6">
              <p className="text-sm font-semibold text-accent">0{n}</p>
              <h2 className="mt-1 text-xl font-bold">{t(`how.${n}.title`)}</h2>
              <p className="mt-1 text-muted">{t(`how.${n}.body`)}</p>
            </Card>
          ))}
        </div>
        <div className="mt-8 flex gap-3">
          <LinkButton to="/register?role=worker" variant="accent">{t('hero.cta.seeker')}</LinkButton>
          <LinkButton to="/register?role=employer" variant="outline">{t('hero.cta.employer')}</LinkButton>
        </div>
      </PageBody>
    </>
  );
}

export function HelpPage() {
  const { t } = useI18n();
  const items = [1, 2, 3, 4, 5].map((i) => ({ q: t(`faq.${i}.q`), a: t(`faq.${i}.a`) }));
  return (
    <>
      <PageHeader title={t('help.title')} subtitle={t('help.subtitle')} />
      <PageBody narrow>
        <Accordion items={items} />
        <p className="mt-6 text-sm text-muted">
          Still need help? <Link to="/contact" className="font-semibold text-accent hover:underline">{t('nav.contact')}</Link>
        </p>
      </PageBody>
    </>
  );
}

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name'),
  email: z.string().trim().email('Enter a valid email'),
  message: z.string().trim().min(10, 'Write at least 10 characters'),
});
type ContactValues = z.infer<typeof contactSchema>;

export function ContactPage() {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ContactValues>({ resolver: zodResolver(contactSchema) });
  const submit = async (values: ContactValues) => {
    setFailed(null);
    try {
      await api('/contact', { method: 'POST', body: values });
      setSent(true);
      reset();
    } catch (e) {
      setFailed(e instanceof ApiError && e.status === 429 ? 'Too many messages from this device. Please try again later.' : 'Your message could not be sent. Please try again.');
    }
  };
  return (
    <>
      <PageHeader title={t('contact.title')} subtitle={t('contact.subtitle')} />
      <PageBody narrow>
        <Card className="p-6">
          <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
            <TextField label={t('contact.name')} error={errors.name?.message} {...register('name')} />
            <TextField label={t('auth.email')} type="email" error={errors.email?.message} {...register('email')} />
            <TextAreaField label={t('contact.message')} error={errors.message?.message} {...register('message')} />
            {sent && <Alert tone="success">Thank you. Your message was sent and our team will reply by email.</Alert>}
            {failed && <Alert tone="danger">{failed}</Alert>}
            <Button type="submit" variant="accent" loading={isSubmitting}>{t('common.submit')}</Button>
          </form>
        </Card>
      </PageBody>
    </>
  );
}

export function PrivacyPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('privacy.title')} subtitle={t('legal.draft')} />
      <PageBody narrow>
        <Prose>
          <h2>What we collect</h2>
          <p>Only what is needed to match people with work: name, phone number, optional email, location (administrative area, and optionally GPS), skills, experience, and documents you choose to upload.</p>
          <h2>What others can see</h2>
          <ul>
            <li>Your phone number and email stay hidden until you apply to a job or accept contact.</li>
            <li>Exact GPS coordinates are never shown to other users; only a coarse area is used for distance.</li>
            <li>You can hide your profile from employer search.</li>
          </ul>
          <h2>Public statistics</h2>
          <p>National analytics are aggregated and suppressed for very small groups so individuals cannot be identified.</p>
          <h2>Your choices</h2>
          <p>You will be able to edit or delete your data from your account settings once accounts are implemented.</p>
        </Prose>
      </PageBody>
    </>
  );
}

export function TermsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('terms.title')} subtitle={t('legal.draft')} />
      <PageBody narrow>
        <Prose>
          <h2>Using the platform</h2>
          <p>You agree to provide accurate information, to use the service lawfully, and not to post misleading or fraudulent job adverts.</p>
          <h2>Verification</h2>
          <p>A verified badge is shown only when an administrator has reviewed supporting evidence. Self-reported skills are labeled as such.</p>
          <h2>AI recommendations</h2>
          <p>Recommendations are decision support. Employers and job seekers remain responsible for their own hiring and application decisions.</p>
          <h2>Moderation</h2>
          <p>We may remove content or suspend accounts that violate these terms or that are reported and confirmed as fraudulent.</p>
        </Prose>
      </PageBody>
    </>
  );
}

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <PageBody narrow>
      <div className="py-16 text-center">
        <p className="text-6xl font-extrabold text-accent">404</p>
        <h1 className="mt-4 text-2xl font-bold">{t('notfound.title')}</h1>
        <p className="mt-2 text-muted">{t('notfound.body')}</p>
        <LinkButton to="/" className="mt-6">{t('notfound.back')}</LinkButton>
      </div>
    </PageBody>
  );
}

export function InstallPage() {
  const { installed, canInstall, install } = usePwa();
  const mine = detectPlatform();
  return (
    <>
      <PageHeader title="Install EthioTalent AI" subtitle="Use it like an app on your phone, tablet or computer. It also works in any browser without installing." />
      <PageBody narrow>
        {installed && <Alert tone="success">The app is already installed on this device.</Alert>}
        {canInstall && <Button onClick={() => void install()}>Install app</Button>}
        <div className="mt-6 space-y-3">
          {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
            <Card key={p} className={p === mine ? 'border-accent' : ''}>
              <h2 className="font-semibold">{PLATFORM_LABEL[p]}{p === mine ? ' (this device)' : ''}</h2>
              <p className="mt-1 text-sm text-muted">{INSTALL_STEPS[p]}</p>
            </Card>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted">Installing needs a secure (https) address. Not offered as a store app (Google Play, App Store) in this version. Old browsers that cannot install still run the site normally.</p>
      </PageBody>
    </>
  );
}

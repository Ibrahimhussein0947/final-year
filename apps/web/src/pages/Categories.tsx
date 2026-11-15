import { Link } from 'react-router-dom';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { useI18n } from '@/i18n';
import { CATEGORIES } from '@/lib/taxonomy';

export default function Categories() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('categories.title')} subtitle={t('categories.subtitle')} />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              to={`/jobs?category=${c.slug}`}
              className="group flex items-start gap-4 rounded-2xl border border-border bg-surface p-5 shadow-card transition hover:-translate-y-0.5 hover:border-accent"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <c.icon className="h-6 w-6" aria-hidden />
              </span>
              <span>
                <span className="block font-semibold group-hover:text-accent">{c.name}</span>
                <span className="mt-1 block text-sm text-muted">{c.examples}</span>
              </span>
            </Link>
          ))}
        </div>
      </PageBody>
    </>
  );
}

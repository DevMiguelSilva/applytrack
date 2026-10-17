import type { ReactNode } from 'react'
export function SectionHeader({title,description,actions}: {title:ReactNode;description:string;actions?:ReactNode}) {
  return <header className="ui-section-header"><div className="ui-heading-copy"><h1 className="ui-title">{title}</h1><p className="ui-description">{description}</p></div>{actions && <div className="ui-header-actions">{actions}</div>}</header>
}
